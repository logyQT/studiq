import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import { buildQueryFilter, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import type { TeacherFlashcardStatsResponse, TeacherFlashcardStatsQuery, DifficultyBucket, DifficultyFlashcardDetail } from '@/server/models';

const emptyResponse: TeacherFlashcardStatsResponse = {
  summary: {
    totalDecks: 0,
    totalFlashcards: 0,
    totalPractices: 0,
    totalStudents: 0,
    overallAccuracy: 0,
    averageEasinessFactor: 0,
    difficultyBreakdown: { easy: 0, medium: 0, hard: 0, new: 0 },
  },
  byDeck: [],
  byTopic: [],
};

export class FlashcardStatsService {
  async getTeacherStats(
    ctx: RequestContext,
    filters?: TeacherFlashcardStatsQuery,
  ): Promise<TeacherFlashcardStatsResponse> {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) {
      return emptyResponse;
    }

    let flashcardQuery = supabase.from('flashcards').select('id');
    if (filter.or) {
      flashcardQuery = flashcardQuery.or(filter.or);
    } else if (filter.created_by) {
      flashcardQuery = flashcardQuery.eq('created_by', filter.created_by);
    }

    const { data: flashcards, error: fcError } = await flashcardQuery;
    if (fcError) throw mapSupabaseError(fcError);

    const flashcardIds = (flashcards ?? []).map((f) => f.id);
    if (flashcardIds.length === 0) {
      return emptyResponse;
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc('get_teacher_stats', {
      p_flashcard_ids: flashcardIds,
      p_user_id: ctx.userId,
      p_deck_id: filters?.deckId ?? null,
    });

    if (rpcError) throw mapSupabaseError(rpcError);

    return rpcResult as unknown as TeacherFlashcardStatsResponse;
  }
  async getDifficultyCards(
    ctx: RequestContext,
    bucket: DifficultyBucket,
  ): Promise<DifficultyFlashcardDetail[]> {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return [];

    let flashcardQuery = supabase.from('flashcards').select('id, front, back');
    if (filter.or) {
      flashcardQuery = flashcardQuery.or(filter.or);
    } else if (filter.created_by) {
      flashcardQuery = flashcardQuery.eq('created_by', filter.created_by);
    }

    const { data: flashcards, error: fcError } = await flashcardQuery;
    if (fcError) throw mapSupabaseError(fcError);
    if (!flashcards || flashcards.length === 0) return [];

    const flashcardIds = flashcards.map((f) => f.id);
    const flashcardMap = new Map(flashcards.map((f) => [f.id, f]));

    const { data: deckAssignments } = await supabase
      .from('flashcard_deck_assignments')
      .select('flashcard_id, deck_id')
      .in('flashcard_id', flashcardIds);

    const deckIds = [...new Set((deckAssignments ?? []).map((a) => a.deck_id))];
    const { data: decks } = await supabase
      .from('flashcard_decks')
      .select('id, name')
      .in('id', deckIds);

    const deckNameMap = new Map((decks ?? []).map((d) => [d.id, d.name]));
    const cardToDeckNames = new Map<string, string[]>();
    for (const a of deckAssignments ?? []) {
      const existing = cardToDeckNames.get(a.flashcard_id) ?? [];
      const name = deckNameMap.get(a.deck_id);
      if (name) existing.push(name);
      cardToDeckNames.set(a.flashcard_id, existing);
    }

    const { data: topicAssignments } = await supabase
      .from('flashcard_topic_assignments')
      .select('flashcard_id, topic_id')
      .in('flashcard_id', flashcardIds);

    const topicIds = [...new Set((topicAssignments ?? []).map((a) => a.topic_id))];
    const { data: topics } = await supabase
      .from('flashcard_topics')
      .select('id, name')
      .in('id', topicIds);

    const topicNameMap = new Map((topics ?? []).map((t) => [t.id, t.name]));
    const cardToTopicNames = new Map<string, string[]>();
    for (const a of topicAssignments ?? []) {
      const existing = cardToTopicNames.get(a.flashcard_id) ?? [];
      const name = topicNameMap.get(a.topic_id);
      if (name) existing.push(name);
      cardToTopicNames.set(a.flashcard_id, existing);
    }

    const { data: practiceRows } = await supabase
      .from('flashcard_practice')
      .select('flashcard_id, was_correct, user_id')
      .in('flashcard_id', flashcardIds);

    const pairAccuracy = new Map<string, { correct: number; total: number }>();
    for (const row of practiceRows ?? []) {
      const key = `${row.flashcard_id}:${row.user_id}`;
      const entry = pairAccuracy.get(key) ?? { correct: 0, total: 0 };
      entry.total++;
      if (row.was_correct) entry.correct++;
      pairAccuracy.set(key, entry);
    }

    const cardPracticeTotals = new Map<string, { correct: number; total: number }>();
    for (const row of practiceRows ?? []) {
      const entry = cardPracticeTotals.get(row.flashcard_id) ?? { correct: 0, total: 0 };
      entry.total++;
      if (row.was_correct) entry.correct++;
      cardPracticeTotals.set(row.flashcard_id, entry);
    }

    const cardStudentCounts = new Map<string, Set<string>>();
    for (const row of practiceRows ?? []) {
      if (!cardStudentCounts.has(row.flashcard_id)) cardStudentCounts.set(row.flashcard_id, new Set());
      cardStudentCounts.get(row.flashcard_id)!.add(row.user_id);
    }

    const result: DifficultyFlashcardDetail[] = [];

    for (const fcId of flashcardIds) {
      const fc = flashcardMap.get(fcId)!;
      const totals = cardPracticeTotals.get(fcId);
      const studentSet = cardStudentCounts.get(fcId);

      if (bucket === 'new') {
        if (totals && totals.total > 0) continue;
        result.push({
          id: fc.id,
          front: fc.front,
          back: fc.back,
          accuracy: 0,
          totalAttempts: 0,
          studentCount: 0,
          deckNames: cardToDeckNames.get(fcId) ?? [],
          topicNames: cardToTopicNames.get(fcId) ?? [],
        });
        continue;
      }

      if (!totals || totals.total === 0) continue;

      const cardStudentCount = studentSet?.size ?? 0;

      let easyCount = 0;
      let mediumCount = 0;
      let hardCount = 0;
      for (const [key, entry] of pairAccuracy) {
        if (!key.startsWith(fcId + ':')) continue;
        const rate = entry.correct / entry.total;
        if (rate >= 0.8) easyCount++;
        else if (rate >= 0.5) mediumCount++;
        else hardCount++;
      }

      const majorityBucket: DifficultyBucket =
        hardCount >= mediumCount && hardCount >= easyCount ? 'hard'
        : mediumCount >= easyCount ? 'medium'
        : 'easy';

      if (majorityBucket !== bucket) continue;

      const cardAccuracy = Math.round((totals.correct / totals.total) * 100);

      result.push({
        id: fc.id,
        front: fc.front,
        back: fc.back,
        accuracy: cardAccuracy,
        totalAttempts: totals.total,
        studentCount: cardStudentCount,
        deckNames: cardToDeckNames.get(fcId) ?? [],
        topicNames: cardToTopicNames.get(fcId) ?? [],
      });
    }

    return result;
  }
}

export const flashcardStatsService = new FlashcardStatsService();
