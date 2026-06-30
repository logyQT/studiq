import { log } from '@/lib/logger';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import { questionService } from '@/server/services';

export class StatsService {
  async getTeacherStats(ctx: RequestContext, subjectId?: string) {
    const supabase = await createClient();

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select('id')
      .eq('created_by', ctx.userId);

    if (questionsError) throw mapSupabaseError(questionsError);

    const { data: flashcards, error: flashcardsError } = await supabase
      .from('flashcards')
      .select('id')
      .eq('created_by', ctx.userId);

    if (flashcardsError) throw mapSupabaseError(flashcardsError);

    const stats = {
      totalQuestions: questions?.length ?? 0,
      totalFlashcards: flashcards?.length ?? 0,
    };

    if (subjectId) {
      const questionStats = await questionService.getStatsBySubject(subjectId);
      return { ...stats, subject: questionStats };
    }

    return stats;
  }

  async getStudentStats(ctx: RequestContext) {
    const supabase = await createClient();

    const { data: attempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select('score, total_questions, started_at, config')
      .eq('user_id', ctx.userId)
      .order('started_at', { ascending: false });

    if (attemptsError) throw mapSupabaseError(attemptsError);

    const { data: practice, error: practiceError } = await supabase
      .from('flashcard_practice')
      .select('was_correct, practiced_at')
      .eq('user_id', ctx.userId)
      .order('practiced_at', { ascending: false });

    if (practiceError) throw mapSupabaseError(practiceError);

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select('id')
      .eq('created_by', ctx.userId);

    if (questionsError) throw mapSupabaseError(questionsError);

    const { count: decksCount, error: decksError } = await supabase
      .from('flashcard_decks')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);

    if (decksError) throw mapSupabaseError(decksError);

    const { count: flashcardsCount, error: flashcardsCountError } = await supabase
      .from('flashcards')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);

    if (flashcardsCountError) throw mapSupabaseError(flashcardsCountError);

    const { count: dueCount, error: dueError } = await supabase
      .from('flashcard_review_state')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .lte('next_review_at', new Date().toISOString());

    if (dueError) throw mapSupabaseError(dueError);

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

    return {
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
    };
  }

  async getActivity(ctx: RequestContext, range?: string, startDate?: string, endDate?: string) {
    const supabase = await createClient();

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

    if (error) {
      log.system.error('[getActivity] query failed', { metadata: { traceId: ctx.traceId, error } });
      throw mapSupabaseError(error);
    }

    const { data: settings } = await supabase
      .from('user_study_settings')
      .select('daily_review_goal')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    return {
      items: items ?? [],
      dailyReviewGoal: settings?.daily_review_goal ?? 0,
    };
  }

  async getWeakPoints(ctx: RequestContext) {
    const supabase = await createClient();

    // Step 1: Get all practice records for this user
    const { data: practice, error: practiceError } = await supabase
      .from('flashcard_practice')
      .select('flashcard_id, was_correct')
      .eq('user_id', ctx.userId);

    if (practiceError) throw mapSupabaseError(practiceError);

    if (practice && practice.length > 0) {
      log.trace.info('weak_points/practice_sample', {
        metadata: {
          traceId: ctx.traceId,
          count: practice.length,
          first3: practice.slice(0, 3).map((p) => ({
            fid: p.flashcard_id?.slice(0, 8),
            correct: p.was_correct,
            type: typeof p.was_correct,
          })),
        },
      });
    }

    // Step 2: Build flashcard → deck lookup via flashcard_deck_assignments
    const { data: deckAssignments, error: daError } = await supabase
      .from('flashcard_deck_assignments')
      .select(`
        flashcard_id,
        deck_id,
        flashcard_decks(name)
      `);

    if (daError) throw mapSupabaseError(daError);

    const cardToDecks = new Map<string, Array<{ deckId: string; name: string }>>();
    for (const a of deckAssignments ?? []) {
      const decks = cardToDecks.get(a.flashcard_id) ?? [];
      const deckRaw = a.flashcard_decks as unknown;
      const deckName =
        deckRaw && typeof deckRaw === 'object' && 'name' in (deckRaw as object)
          ? (deckRaw as { name: string }).name
          : ((deckRaw as Array<{ name: string }> | null)?.[0]?.name ?? 'Unknown');
      decks.push({ deckId: a.deck_id, name: deckName });
      cardToDecks.set(a.flashcard_id, decks);
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
        flashcard_topics(name)
      `);

    if (taError) throw mapSupabaseError(taError);

    const cardToTopics = new Map<string, Array<{ topicId: string; name: string }>>();
    for (const a of topicAssignments ?? []) {
      const topics = cardToTopics.get(a.flashcard_id) ?? [];
      const topicRaw = a.flashcard_topics as unknown;
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

    log.trace.info('weak_points/result', {
      metadata: {
        traceId: ctx.traceId,
        deckResults: weakDecksResult,
        topicResults: weakTopicsResult,
      },
    });

    return { weakDecks: weakDecksResult, weakTopics: weakTopicsResult };
  }
}

export const statsService = new StatsService();
