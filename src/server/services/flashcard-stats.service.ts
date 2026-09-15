import type { SupabaseClient } from '@supabase/supabase-js';
import { buildQueryFilter, Permission } from '@/lib/authz';
import { wrapService } from '@/lib/observability';
import type { RequestContext } from '@/lib/request-context';
import { type ServiceResult, success } from '@/lib/service-result';
import { createClient } from '@/lib/supabase/server';
import { toDbFailure } from '@/lib/supabase-errors';
import type {
  DifficultyBucket,
  DifficultyFlashcardDetail,
  TeacherFlashcardStatsQuery,
  TeacherFlashcardStatsResponse,
} from '@/server/models/flashcard-stats.model';

export class FlashcardStatsService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getTeacherStats(
    ctx: RequestContext,
    filters?: TeacherFlashcardStatsQuery,
  ): Promise<ServiceResult<TeacherFlashcardStatsResponse>> {
    const supabase = await this.createClient();

    const filter = buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) {
      return success(emptyResponse);
    }

    let flashcardQuery = supabase.from('flashcards').select('id');
    if (filter.organization_id) {
      flashcardQuery = flashcardQuery.eq('organization_id', filter.organization_id);
    }
    if (filter.created_by) {
      flashcardQuery = flashcardQuery.eq('created_by', filter.created_by);
    }

    const { data: flashcards, error: fcError } = await flashcardQuery;
    if (fcError) return toDbFailure(fcError);

    const flashcardIds = (flashcards ?? []).map((f) => f.id);
    if (flashcardIds.length === 0) {
      return success(emptyResponse);
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc('get_teacher_stats', {
      p_flashcard_ids: flashcardIds,
      p_user_id: ctx.userId,
      p_deck_id: filters?.deckId ?? null,
    });

    if (rpcError) return toDbFailure(rpcError);

    return success(rpcResult as unknown as TeacherFlashcardStatsResponse);
  }

  async getDifficultyCards(
    ctx: RequestContext,
    bucket: DifficultyBucket,
  ): Promise<ServiceResult<DifficultyFlashcardDetail[]>> {
    const supabase = await this.createClient();

    const filter = buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return success([]);

    let flashcardQuery = supabase.from('flashcards').select('id, front, back');
    if (filter.organization_id) {
      flashcardQuery = flashcardQuery.eq('organization_id', filter.organization_id);
    }
    if (filter.created_by) {
      flashcardQuery = flashcardQuery.eq('created_by', filter.created_by);
    }

    const { data: flashcards, error: fcError } = await flashcardQuery;
    if (fcError) return toDbFailure(fcError);
    if (!flashcards || flashcards.length === 0) return success([]);

    const flashcardIds = flashcards.map((f) => f.id);
    const flashcardMap = new Map(flashcards.map((f) => [f.id, f]));

    const { data: flashcardsWithDecks } = await supabase
      .from('flashcards')
      .select('id, deck_id, flashcard_decks!inner(id, name)')
      .in('id', flashcardIds)
      .not('deck_id', 'is', null);

    const deckNameMap = new Map<string, string>();
    const cardToDeckId = new Map<string, string>();
    const cardToDeckName = new Map<string, string>();
    for (const f of flashcardsWithDecks ?? []) {
      const deckRaw = f.flashcard_decks as unknown;
      const deck = Array.isArray(deckRaw) ? deckRaw[0] : deckRaw;
      if (deck) {
        deckNameMap.set(deck.id, deck.name);
        cardToDeckId.set(f.id, deck.id);
        cardToDeckName.set(f.id, deck.name);
      }
    }

    const { data: topicAssignments } = await supabase
      .from('flashcard_topic_assignments')
      .select('flashcard_id, topic_id')
      .in('flashcard_id', flashcardIds);

    const topicIds = [...new Set((topicAssignments ?? []).map((a) => a.topic_id))];
    const { data: topics } = await supabase.from('topics').select('id, name').in('id', topicIds);

    const topicNameMap = new Map((topics ?? []).map((t) => [t.id, t.name]));
    const cardToTopicIds = new Map<string, string[]>();
    const cardToTopicNames = new Map<string, string[]>();
    for (const a of topicAssignments ?? []) {
      const ids = cardToTopicIds.get(a.flashcard_id) ?? [];
      ids.push(a.topic_id);
      cardToTopicIds.set(a.flashcard_id, ids);
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
      if (!cardStudentCounts.has(row.flashcard_id))
        cardStudentCounts.set(row.flashcard_id, new Set());
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
          deckId: cardToDeckId.get(fcId) ?? '',
          deckName: cardToDeckName.get(fcId) ?? '',
          topicIds: cardToTopicIds.get(fcId) ?? [],
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
        if (!key.startsWith(`${fcId}:`)) continue;
        const rate = entry.correct / entry.total;
        if (rate >= 0.8) easyCount++;
        else if (rate >= 0.5) mediumCount++;
        else hardCount++;
      }

      const majorityBucket: DifficultyBucket =
        hardCount >= mediumCount && hardCount >= easyCount
          ? 'hard'
          : mediumCount >= easyCount
            ? 'medium'
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
        deckId: cardToDeckId.get(fcId) ?? '',
        deckName: cardToDeckName.get(fcId) ?? '',
        topicIds: cardToTopicIds.get(fcId) ?? [],
        topicNames: cardToTopicNames.get(fcId) ?? [],
      });
    }

    return success(result);
  }
}

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
export const flashcardStatsService = wrapService(
  new FlashcardStatsService(createClient),
  'flashcard-stats.service',
);
