import type { RequestContext } from '@studiq/authz';
import { hiddenResultAssignmentIds } from '@studiq/server/lib/assignment-visibility';
import { gradableQuestionCounts } from '@studiq/server/lib/gradable-questions';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  ProblematicQuestionStats,
  StudentStatsResponse,
  TeacherQuizStatsItem,
  TeacherStatsQuery,
  TeacherStatsResponse,
} from '@studiq/server/models/stats.model';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Max score of an attempt: awarded points for assignment attempts, question
 * count for practice quizzes. Never 0, so it is always safe as a denominator.
 */
function attemptTotal(a: { total_questions: number; total_points?: number | null }): number {
  return Math.max(a.total_points ?? a.total_questions ?? 0, 1);
}

/**
 * Attempt score as a percentage of its own scale, clamped to 0–100.
 *
 * Teacher aggregates mix assignment attempts (`score` = awarded points, max =
 * `total_points`) with practice attempts (`score` = correct answers, max =
 * `total_questions`), so raw scores are not comparable — each attempt has to be
 * normalised before averaging. The clamp guards the case where `score` exceeds
 * the `total_points` snapshot taken when the attempt started.
 */
function attemptScorePercent(a: {
  score: number | null;
  total_questions: number;
  total_points?: number | null;
}): number {
  const pct = ((a.score ?? 0) / attemptTotal(a)) * 100;
  return Math.min(100, Math.max(0, pct));
}

export class StatsService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getTeacherStats(
    ctx: RequestContext,
    filters?: TeacherStatsQuery,
  ): Promise<ServiceResult<TeacherStatsResponse>> {
    const supabase = await this.createClient();

    let questionsQuery = supabase
      .from('questions')
      .select('id, type, bank_id')
      .eq('created_by', ctx.userId);
    if (ctx.activeOrgId) questionsQuery = questionsQuery.eq('organization_id', ctx.activeOrgId);
    const { data: questions, error: questionsError } = await questionsQuery;

    if (questionsError) return toDbFailure(questionsError);

    let flashcardsQuery = supabase.from('flashcards').select('id').eq('created_by', ctx.userId);
    if (ctx.activeOrgId) flashcardsQuery = flashcardsQuery.eq('organization_id', ctx.activeOrgId);
    const { data: flashcards, error: flashcardsError } = await flashcardsQuery;

    if (flashcardsError) return toDbFailure(flashcardsError);

    const rows: Array<{ type: string; bank_id: string }> = questions ?? [];

    // “Subject” counts are a group-by over the same own-questions row set, so
    // `subjectId` can only ever narrow the type split — it never widens the
    // query or leaks another tenant's counts.
    const countsByBank = new Map<string, number>();
    for (const row of rows) {
      countsByBank.set(row.bank_id, (countsByBank.get(row.bank_id) ?? 0) + 1);
    }

    const bankIds = [...countsByBank.keys()];
    const bankNames = new Map<string, string>();
    if (bankIds.length > 0) {
      const { data: banks, error: banksError } = await supabase
        .from('question_banks')
        .select('id, name')
        .in('id', bankIds);

      if (banksError) return toDbFailure(banksError);

      for (const bank of banks ?? []) bankNames.set(bank.id, bank.name);
    }

    const bySubject = bankIds
      .map((bankId) => ({
        subjectId: bankId,
        // A question can outlive visibility of its bank (e.g. the teacher left
        // the bank's org), so a missing name stays null instead of being faked.
        subjectName: bankNames.get(bankId) ?? null,
        questionCount: countsByBank.get(bankId) ?? 0,
      }))
      .sort((a, b) => {
        if (a.subjectName === null) return b.subjectName === null ? 0 : 1;
        if (b.subjectName === null) return -1;
        return a.subjectName.localeCompare(b.subjectName, 'pl');
      });

    // Postgres UUIDs compare case-insensitively; normalize so a hand-written
    // uppercase ?subjectId= matches the canonical lowercase bank_id.
    const subjectId = filters?.subjectId?.toLowerCase();
    const typeScope = subjectId ? rows.filter((row) => row.bank_id === subjectId) : rows;
    const byType: Record<string, number> = {};
    for (const row of typeScope) {
      byType[row.type] = (byType[row.type] ?? 0) + 1;
    }

    // Per-question accuracy is aggregated in SQL (#204): loading the class's
    // whole `student_answers` set here would hit PostgREST's 1000-row cap and
    // silently understate every correct rate.
    const { data: problematicQuestions, error: problematicQuestionsError } = await supabase.rpc(
      'get_teacher_problematic_questions',
      {
        p_user_id: ctx.userId,
        p_organization_id: ctx.activeOrgId ?? null,
        p_bank_id: subjectId ?? null,
      },
    );

    if (problematicQuestionsError) return toDbFailure(problematicQuestionsError);

    return success({
      totalQuestions: rows.length,
      totalFlashcards: flashcards?.length ?? 0,
      subject: {
        byType,
        problematicQuestions: (problematicQuestions as ProblematicQuestionStats[] | null) ?? [],
      },
      bySubject,
    });
  }

  async getStudentStats(ctx: RequestContext): Promise<ServiceResult<StudentStatsResponse>> {
    const supabase = await this.createClient();

    // quiz_attempts, flashcard_practice and flashcard_review_state carry no
    // organization_id of their own (they're pure user-activity logs keyed by
    // user_id/flashcard_id), so these three stay unscoped by org — a user in
    // multiple orgs will see their activity from all of them combined here.
    const { data: attempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select('id, score, total_questions, total_points, started_at, config, assignment_id')
      .eq('user_id', ctx.userId)
      .order('started_at', { ascending: false });

    if (attemptsError) return toDbFailure(attemptsError);

    // A hidden assignment result must not leak through an aggregate either — a
    // single attempt would surface as avgScore = 100%. Hidden attempts stay in
    // `totalQuizzes` below: a count is not a result (#374).
    const hidden = await hiddenResultAssignmentIds(
      supabase,
      (attempts ?? []).map((attempt) => attempt.assignment_id),
    );
    if (isFailure(hidden)) return hidden;

    const scoredAttempts = (attempts ?? []).filter(
      (attempt) => !attempt.assignment_id || !hidden.data.has(attempt.assignment_id),
    );

    // A practice score is correct answers over the *closed* questions only
    // (#329): `total_questions` counts open answers that can never be graded, so
    // dividing by it makes this page disagree with the review headline for the
    // same attempt (#619). Assignment attempts stay teacher-graded in points and
    // never enter this lookup.
    const gradable = await gradableQuestionCounts(
      supabase,
      scoredAttempts.filter((attempt) => !attempt.assignment_id).map((attempt) => attempt.id),
    );
    if (isFailure(gradable)) return gradable;

    // Each attempt is normalised to its own max before averaging. A practice
    // attempt with no closed question has no denominator at all, so it is left
    // out of the score aggregates instead of being faked as 0 %.
    const gradedAttempts = scoredAttempts.flatMap((attempt) => {
      const total = attempt.assignment_id
        ? attemptTotal(attempt)
        : (gradable.data.get(attempt.id) ?? 0);
      return total > 0 ? [{ attempt, total }] : [];
    });

    const { data: practice, error: practiceError } = await supabase
      .from('flashcard_practice')
      .select('was_correct, practiced_at')
      .eq('user_id', ctx.userId)
      .order('practiced_at', { ascending: false });

    if (practiceError) return toDbFailure(practiceError);

    let questionsQuery = supabase.from('questions').select('id').eq('created_by', ctx.userId);
    if (ctx.activeOrgId) questionsQuery = questionsQuery.eq('organization_id', ctx.activeOrgId);
    const { data: questions, error: questionsError } = await questionsQuery;

    if (questionsError) return toDbFailure(questionsError);

    let decksQuery = supabase
      .from('flashcard_decks')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);
    if (ctx.activeOrgId) decksQuery = decksQuery.eq('organization_id', ctx.activeOrgId);
    const { count: decksCount, error: decksError } = await decksQuery;

    if (decksError) return toDbFailure(decksError);

    let flashcardsCountQuery = supabase
      .from('flashcards')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);
    if (ctx.activeOrgId)
      flashcardsCountQuery = flashcardsCountQuery.eq('organization_id', ctx.activeOrgId);
    const { count: flashcardsCount, error: flashcardsCountError } = await flashcardsCountQuery;

    if (flashcardsCountError) return toDbFailure(flashcardsCountError);

    const { count: dueCount, error: dueError } = await supabase
      .from('flashcard_review_state')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .lte('next_review_at', new Date().toISOString());

    if (dueError) return toDbFailure(dueError);

    const totalQuizzes = attempts?.length ?? 0;
    // Single rounding rule for per-attempt percentages. avgScore below keeps its
    // own expression on purpose — reusing the helper there would change its
    // rounding and shift existing values by ±1.
    const percentageOf = (attempt: { score: number | null }, total: number) =>
      Math.round(((attempt.score ?? 0) / total) * 100);
    // `null` = no attempt had a gradable denominator, so there is no result to
    // report. The UI renders `—` instead of a fabricated 0 % (#619).
    const avgScore =
      gradedAttempts.length > 0
        ? Math.round(
            (gradedAttempts.reduce(
              (sum, { attempt, total }) => sum + (attempt.score ?? 0) / total,
              0,
            ) /
              gradedAttempts.length) *
              100,
          )
        : null;
    // Highest per-attempt percentage. Unfinished attempts score 0, so they can
    // never raise the maximum; assignment attempts use total_points via
    // attemptTotal(), same basis as avgScore and attemptsOverTime.
    const bestScore =
      gradedAttempts.length > 0
        ? gradedAttempts.reduce(
            (best, { attempt, total }) => Math.max(best, percentageOf(attempt, total)),
            0,
          )
        : null;

    const flashcardCorrect = practice?.filter((p) => p.was_correct).length ?? 0;
    const flashcardTotal = practice?.length ?? 0;

    return success({
      totalQuizzes,
      avgScore,
      bestScore,
      totalQuestionsCreated: questions?.length ?? 0,
      flashcardsPracticed: flashcardTotal,
      flashcardAccuracy:
        flashcardTotal > 0 ? Math.round((flashcardCorrect / flashcardTotal) * 100) : 0,
      totalDecks: decksCount ?? 0,
      totalFlashcards: flashcardsCount ?? 0,
      dueToday: dueCount ?? 0,
      attemptsOverTime: gradedAttempts.map(({ attempt, total }) => ({
        date: attempt.started_at,
        score: attempt.score,
        total,
        percentage: percentageOf(attempt, total),
      })),
    });
  }

  /**
   * Aggregated quiz performance for the caller's active organization.
   *
   * `quiz_attempts` has no `organization_id` column, so the scope must be
   * applied here: resolve the org's student members (`member` role) and
   * aggregate their attempts. Without an active org (or without a verified
   * membership — `withAuth` only sets `activeOrgId`/`orgRoleId` when the caller
   * is actually a member) there is no class to report on, so the list is empty
   * rather than falling back to every attempt in the deployment. RLS ("Own or
   * same-org quiz attempts") enforces the same-org floor independently.
   *
   * All attempts are aggregated, not just completed ones — `quiz_attempts` rows
   * are created when a quiz is started (`completed_at` stays null until submit),
   * so the row set is the "started" population and the completed/incomplete
   * split is what makes the completion rate meaningful:
   *
   * - `totalAttempts` — attempts started (quizzes the students opened)
   * - `avgScore` — mean of the per-attempt scores normalised to their own max
   *   (`total_points` for assignment attempts, `total_questions` for practice),
   *   over completed attempts only, so an abandoned attempt cannot drag it down
   * - `avgCompletionRate` — `round(completed / started * 100)`, integer 0–100
   */
  async getTeacherQuizStats(ctx: RequestContext): Promise<ServiceResult<TeacherQuizStatsItem[]>> {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId || !ctx.orgRoleId) return success([]);

    const { data: members, error: membersError } = await supabase
      .from('org_members')
      .select('user_id, org_roles!inner(name)')
      .eq('organization_id', ctx.activeOrgId)
      .eq('org_roles.name', 'member');

    if (membersError) return toDbFailure(membersError);

    const studentIds = (members ?? []).map((m) => m.user_id as string);
    if (studentIds.length === 0) return success([]);

    const { data, error } = await supabase
      .from('quiz_attempts')
      .select(
        'id, score, total_questions, total_points, started_at, completed_at, config, assignment_id',
      )
      .in('user_id', studentIds);

    if (error) return toDbFailure(error);

    const attempts = data ?? [];

    // Assignment attempts never store `config.title` (`startAttempt` writes
    // only user/assignment/score columns), so a config-less row with an
    // `assignment_id` would otherwise render as „Quiz bez tytułu”. Their display
    // name comes from the assignment and, when it was built from a saved quiz,
    // from the quiz itself. Both lookups are scoped to the active org: a student
    // can belong to several orgs, and an attempt on another org's assignment must
    // not surface that org's names here (#207).
    const assignmentNames = new Map<string, string>();
    const assignmentIds = [
      ...new Set(
        attempts
          .map((row) => row.assignment_id)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];

    if (assignmentIds.length > 0) {
      const { data: assignments, error: assignmentsError } = await supabase
        .from('teacher_assignments')
        .select('id, title, quiz_id')
        .in('id', assignmentIds)
        .eq('organization_id', ctx.activeOrgId);

      if (assignmentsError) return toDbFailure(assignmentsError);

      const quizIds = [
        ...new Set(
          (assignments ?? [])
            .map((assignment) => assignment.quiz_id)
            .filter((id): id is string => typeof id === 'string'),
        ),
      ];

      const quizNames = new Map<string, string>();
      if (quizIds.length > 0) {
        const { data: quizzes, error: quizzesError } = await supabase
          .from('quizzes')
          .select('id, name')
          .in('id', quizIds)
          // Defence in depth: the ids already come from active-org assignments,
          // but the FK does not enforce same-org linkage.
          .eq('organization_id', ctx.activeOrgId);

        if (quizzesError) return toDbFailure(quizzesError);
        for (const quiz of quizzes ?? []) quizNames.set(quiz.id, quiz.name);
      }

      for (const assignment of assignments ?? []) {
        const name =
          (assignment.quiz_id ? quizNames.get(assignment.quiz_id) : undefined) ?? assignment.title;
        if (name) assignmentNames.set(assignment.id, name);
      }
    }

    const quizMap = new Map<
      string,
      { startedAttempts: number; completedAttempts: number; totalPercent: number }
    >();

    for (const row of attempts) {
      const config = row.config as { title?: string } | null;
      // Precedence: an explicit stored title, then the quiz behind the
      // assignment, then the assignment title. Untitled rows stay null and the
      // UI supplies the localized label.
      const title =
        config?.title ??
        (row.assignment_id ? assignmentNames.get(row.assignment_id) : undefined) ??
        null;
      const key = title ?? '';

      if (!quizMap.has(key)) {
        quizMap.set(key, { startedAttempts: 0, completedAttempts: 0, totalPercent: 0 });
      }

      const stats = quizMap.get(key)!;
      stats.startedAttempts += 1;
      // Started-but-unfinished attempts count in the denominator only.
      if (row.completed_at !== null) {
        stats.completedAttempts += 1;
        stats.totalPercent += attemptScorePercent(row);
      }
    }

    return success(
      Array.from(quizMap.entries()).map(([key, stats]) => ({
        id: key,
        title: key === '' ? null : key,
        totalAttempts: stats.startedAttempts,
        // Unrounded on purpose: both clients call Math.round, so keeping the
        // exact mean avoids double-rounding.
        avgScore: stats.completedAttempts > 0 ? stats.totalPercent / stats.completedAttempts : 0,
        // Rounded in the service: every entry has startedAttempts >= 1, so this
        // is a clean 0–100 integer and the clients' Math.round is a no-op.
        avgCompletionRate: Math.round((stats.completedAttempts / stats.startedAttempts) * 100),
      })),
    );
  }

  async getActivity(
    ctx: RequestContext,
    range?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    let start: string;
    const end: string = endDate ?? new Date().toISOString().split('T')[0];

    if (startDate) {
      start = startDate;
    } else if (range === '1y') {
      start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else if (range === '30d') {
      start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else {
      start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    const { data: items, error } = await supabase
      .from('user_daily_activity')
      .select('*')
      .eq('user_id', ctx.userId)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true });

    if (error) return toDbFailure(error);

    const { data: settings } = await supabase
      .from('user_study_settings')
      .select('daily_review_goal')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    return success({
      items: items ?? [],
      dailyReviewGoal: settings?.daily_review_goal ?? 0,
    });
  }

  async getWeakPoints(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    // Step 1: Get all practice records for this user
    const { data: practice, error: practiceError } = await supabase
      .from('flashcard_practice')
      .select('flashcard_id, was_correct')
      .eq('user_id', ctx.userId);

    if (practiceError) return toDbFailure(practiceError);

    // Step 2: Build flashcard → deck lookup via direct deck_id
    const { data: flashcardsWithDecks, error: daError } = await supabase
      .from('flashcards')
      .select('id, deck_id, flashcard_decks(id, name)')
      .not('deck_id', 'is', null);

    if (daError) return toDbFailure(daError);

    const cardToDecks = new Map<string, Array<{ deckId: string; name: string }>>();
    for (const f of flashcardsWithDecks ?? []) {
      const decks = cardToDecks.get(f.id) ?? [];
      const deckRaw = f.flashcard_decks as unknown;
      const deckData = Array.isArray(deckRaw) ? deckRaw[0] : deckRaw;
      if (deckData) {
        decks.push({ deckId: f.deck_id, name: deckData.name ?? 'Unknown' });
        cardToDecks.set(f.id, decks);
      }
    }

    const deckMap = new Map<string, { name: string; total: number; correct: number }>();
    for (const p of practice ?? []) {
      const decks = cardToDecks.get(p.flashcard_id) ?? [];
      for (const d of decks) {
        const entry = deckMap.get(d.deckId) ?? { name: d.name, total: 0, correct: 0 };
        entry.total++;
        if (p.was_correct === true || p.was_correct === 'true') entry.correct++;
        deckMap.set(d.deckId, entry);
      }
    }

    const weakDecksResult = [...deckMap.entries()]
      .map(([deckId, stats]) => ({
        deckId,
        name: stats.name,
        accuracy: Math.round((stats.correct / Math.max(stats.total, 1)) * 100),
        totalAttempts: stats.total,
      }))
      .filter((d) => d.totalAttempts >= 5)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 5);

    // Step 3: Build flashcard → topic lookup
    const { data: topicAssignments, error: taError } = await supabase.from(
      'flashcard_topic_assignments',
    ).select(`
        flashcard_id,
        topic_id,
        topics(name)
      `);

    if (taError) return toDbFailure(taError);

    const cardToTopics = new Map<string, Array<{ topicId: string; name: string }>>();
    for (const a of topicAssignments ?? []) {
      const topics = cardToTopics.get(a.flashcard_id) ?? [];
      const topicRaw = a.topics as unknown;
      const topicName =
        topicRaw && typeof topicRaw === 'object' && 'name' in (topicRaw as object)
          ? (topicRaw as { name: string }).name
          : ((topicRaw as Array<{ name: string }> | null)?.[0]?.name ?? 'Unknown');
      topics.push({ topicId: a.topic_id, name: topicName });
      cardToTopics.set(a.flashcard_id, topics);
    }

    const topicMap = new Map<string, { name: string; total: number; correct: number }>();
    for (const p of practice ?? []) {
      const topics = cardToTopics.get(p.flashcard_id) ?? [];
      for (const t of topics) {
        const entry = topicMap.get(t.topicId) ?? { name: t.name, total: 0, correct: 0 };
        entry.total++;
        if (p.was_correct === true || p.was_correct === 'true') entry.correct++;
        topicMap.set(t.topicId, entry);
      }
    }

    const weakTopicsResult = [...topicMap.entries()]
      .map(([topicId, stats]) => ({
        topicId,
        name: stats.name,
        accuracy: Math.round((stats.correct / Math.max(stats.total, 1)) * 100),
        totalAttempts: stats.total,
      }))
      .filter((t) => t.totalAttempts >= 5)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 5);

    return success({ weakDecks: weakDecksResult, weakTopics: weakTopicsResult });
  }
}
export const statsService = wrapService(new StatsService(createClient), 'stats.service');
