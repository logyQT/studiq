import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';

export class StatsService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getTeacherStats(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    let questionsQuery = supabase.from('questions').select('id').eq('created_by', ctx.userId);
    if (ctx.activeOrgId) questionsQuery = questionsQuery.eq('organization_id', ctx.activeOrgId);
    const { data: questions, error: questionsError } = await questionsQuery;

    if (questionsError) return toDbFailure(questionsError);

    let flashcardsQuery = supabase.from('flashcards').select('id').eq('created_by', ctx.userId);
    if (ctx.activeOrgId) flashcardsQuery = flashcardsQuery.eq('organization_id', ctx.activeOrgId);
    const { data: flashcards, error: flashcardsError } = await flashcardsQuery;

    if (flashcardsError) return toDbFailure(flashcardsError);

    return success({
      totalQuestions: questions?.length ?? 0,
      totalFlashcards: flashcards?.length ?? 0,
    });
  }

  async getStudentStats(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    // quiz_attempts, flashcard_practice and flashcard_review_state carry no
    // organization_id of their own (they're pure user-activity logs keyed by
    // user_id/flashcard_id), so these three stay unscoped by org — a user in
    // multiple orgs will see their activity from all of them combined here.
    const { data: attempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select('score, total_questions, started_at, config')
      .eq('user_id', ctx.userId)
      .order('started_at', { ascending: false });

    if (attemptsError) return toDbFailure(attemptsError);

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
    const avgScore =
      attempts && attempts.length > 0
        ? Math.round(
            (attempts.reduce((sum, a) => sum + a.score / Math.max(a.total_questions, 1), 0) /
              attempts.length) *
              100,
          )
        : 0;

    const flashcardCorrect = practice?.filter((p) => p.was_correct).length ?? 0;
    const flashcardTotal = practice?.length ?? 0;

    return success({
      totalQuizzes,
      avgScore,
      totalQuestionsCreated: questions?.length ?? 0,
      flashcardsPracticed: flashcardTotal,
      flashcardAccuracy:
        flashcardTotal > 0 ? Math.round((flashcardCorrect / flashcardTotal) * 100) : 0,
      totalDecks: decksCount ?? 0,
      totalFlashcards: flashcardsCount ?? 0,
      dueToday: dueCount ?? 0,
      attemptsOverTime:
        attempts?.map((a) => ({
          date: a.started_at,
          score: a.score,
          total: a.total_questions,
          percentage: Math.round((a.score / Math.max(a.total_questions, 1)) * 100),
        })) ?? [],
    });
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
    const { data: topicAssignments, error: taError } = await supabase
      .from('flashcard_topic_assignments')
      .select(`
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
