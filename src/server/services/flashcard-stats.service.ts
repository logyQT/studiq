import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import { buildQueryFilter, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import type { TeacherFlashcardStatsResponse, TeacherFlashcardStatsQuery, DifficultyBucket, DifficultyFlashcardDetail } from '@/server/models';

export class FlashcardStatsService {
  async getTeacherStats(
    ctx: RequestContext,
    filters?: TeacherFlashcardStatsQuery,
  ): Promise<TeacherFlashcardStatsResponse> {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) {
      return { summary: { totalDecks: 0, totalFlashcards: 0, totalPractices: 0, totalStudents: 0, overallAccuracy: 0, averageEasinessFactor: 0, difficultyBreakdown: { easy: 0, medium: 0, hard: 0, new: 0 } }, byDeck: [], byTopic: [] };
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
      return { summary: { totalDecks: 0, totalFlashcards: 0, totalPractices: 0, totalStudents: 0, overallAccuracy: 0, averageEasinessFactor: 0, difficultyBreakdown: { easy: 0, medium: 0, hard: 0, new: 0 } }, byDeck: [], byTopic: [] };
    }

    const { data: decks, error: decksError } = await supabase
      .from('flashcard_decks')
      .select('id, name')
      .eq('created_by', ctx.userId);

    if (decksError) throw mapSupabaseError(decksError);

    const deckMap = new Map((decks ?? []).map((d) => [d.id, d.name]));

    const { data: deckAssignments, error: daError } = await supabase
      .from('flashcard_deck_assignments')
      .select('flashcard_id, deck_id')
      .in('flashcard_id', flashcardIds);

    if (daError) throw mapSupabaseError(daError);

    const cardToDecks = new Map<string, string[]>();
    for (const a of deckAssignments ?? []) {
      const existing = cardToDecks.get(a.flashcard_id) ?? [];
      existing.push(a.deck_id);
      cardToDecks.set(a.flashcard_id, existing);
    }

    const filteredFlashcardIds = filters?.deckId
      ? flashcardIds.filter((id) => (cardToDecks.get(id) ?? []).includes(filters.deckId!))
      : flashcardIds;

    if (filteredFlashcardIds.length === 0) {
      return { summary: { totalDecks: 0, totalFlashcards: 0, totalPractices: 0, totalStudents: 0, overallAccuracy: 0, averageEasinessFactor: 0, difficultyBreakdown: { easy: 0, medium: 0, hard: 0, new: 0 } }, byDeck: [], byTopic: [] };
    }

    const { data: practiceRows, error: practiceError } = await supabase
      .from('flashcard_practice')
      .select('flashcard_id, was_correct, user_id')
      .in('flashcard_id', filteredFlashcardIds);

    if (practiceError) throw mapSupabaseError(practiceError);

    const { data: reviewStates, error: rsError } = await supabase
      .from('flashcard_review_state')
      .select('flashcard_id, easiness_factor, user_id')
      .in('flashcard_id', filteredFlashcardIds);

    if (rsError) throw mapSupabaseError(rsError);

    const { data: topicAssignments, error: taError } = await supabase
      .from('flashcard_topic_assignments')
      .select('flashcard_id, topic_id')
      .in('flashcard_id', filteredFlashcardIds);

    if (taError) throw mapSupabaseError(taError);

    const topicIds = [...new Set((topicAssignments ?? []).map((a) => a.topic_id))];

    const { data: topics, error: topicsError } = await supabase
      .from('flashcard_topics')
      .select('id, name')
      .in('id', topicIds);

    if (topicsError) throw mapSupabaseError(topicsError);

    const topicNameMap = new Map((topics ?? []).map((t) => [t.id, t.name]));

    const cardToTopics = new Map<string, string[]>();
    for (const a of topicAssignments ?? []) {
      const existing = cardToTopics.get(a.flashcard_id) ?? [];
      existing.push(a.topic_id);
      cardToTopics.set(a.flashcard_id, existing);
    }

    const totalPractices = practiceRows?.length ?? 0;
    const correctPractices = (practiceRows ?? []).filter((p) => p.was_correct).length;
    const overallAccuracy = totalPractices > 0 ? Math.round((correctPractices / totalPractices) * 100) : 0;

    const uniqueStudents = new Set((practiceRows ?? []).map((p) => p.user_id)).size;

    const efValues = (reviewStates ?? []).map((r) => r.easiness_factor);
    const avgEF = efValues.length > 0
      ? Math.round((efValues.reduce((s, v) => s + v, 0) / efValues.length) * 100) / 100
      : 0;

    const deckPracticeMap = new Map<string, { practiceCount: number; correctCount: number }>();
    const deckReviewMap = new Map<string, { totalEF: number; count: number }>();
    const deckFlashcardCount = new Map<string, Set<string>>();

    for (const fcId of filteredFlashcardIds) {
      const deckIds = cardToDecks.get(fcId) ?? [];
      for (const dId of deckIds) {
        if (filters?.deckId && dId !== filters.deckId) continue;
        if (!deckFlashcardCount.has(dId)) deckFlashcardCount.set(dId, new Set());
        deckFlashcardCount.get(dId)!.add(fcId);
      }
    }

    for (const row of practiceRows ?? []) {
      const deckIds = cardToDecks.get(row.flashcard_id) ?? [];
      for (const dId of deckIds) {
        if (filters?.deckId && dId !== filters.deckId) continue;
        const existing = deckPracticeMap.get(dId) ?? { practiceCount: 0, correctCount: 0 };
        existing.practiceCount++;
        if (row.was_correct) existing.correctCount++;
        deckPracticeMap.set(dId, existing);
      }
    }

    for (const row of reviewStates ?? []) {
      const deckIds = cardToDecks.get(row.flashcard_id) ?? [];
      for (const dId of deckIds) {
        if (filters?.deckId && dId !== filters.deckId) continue;
        const existing = deckReviewMap.get(dId) ?? { totalEF: 0, count: 0 };
        existing.totalEF += row.easiness_factor;
        existing.count++;
        deckReviewMap.set(dId, existing);
      }
    }

    const byDeck = (decks ?? [])
      .filter((d) => !filters?.deckId || d.id === filters.deckId)
      .map((deck) => {
        const fcCount = deckFlashcardCount.get(deck.id)?.size ?? 0;
        const practice = deckPracticeMap.get(deck.id);
        const review = deckReviewMap.get(deck.id);
        const practiceCount = practice?.practiceCount ?? 0;
        const correctCount = practice?.correctCount ?? 0;
        const accuracy = practiceCount > 0 ? Math.round((correctCount / practiceCount) * 100) : 0;
        const avgEasinessFactor = review && review.count > 0
          ? Math.round((review.totalEF / review.count) * 100) / 100
          : 0;

        return {
          deckId: deck.id,
          deckName: deck.name,
          flashcardCount: fcCount,
          practiceCount,
          correctCount,
          accuracy,
          avgEasinessFactor,
        };
      })
      .filter((d) => d.flashcardCount > 0);

    const cardPracticesForTopics = new Map<string, { practiceCount: number; correctCount: number }>();
    for (const row of practiceRows ?? []) {
      const topicIds = cardToTopics.get(row.flashcard_id) ?? [];
      for (const tId of topicIds) {
        const existing = cardPracticesForTopics.get(tId) ?? { practiceCount: 0, correctCount: 0 };
        existing.practiceCount++;
        if (row.was_correct) existing.correctCount++;
        cardPracticesForTopics.set(tId, existing);
      }
    }

    const topicFlashcardCount = new Map<string, Set<string>>();
    for (const fcId of filteredFlashcardIds) {
      const tIds = cardToTopics.get(fcId) ?? [];
      for (const tId of tIds) {
        if (!topicFlashcardCount.has(tId)) topicFlashcardCount.set(tId, new Set());
        topicFlashcardCount.get(tId)!.add(fcId);
      }
    }

    const byTopic = [...topicFlashcardCount.entries()]
      .map(([topicId, fcSet]) => {
        const practice = cardPracticesForTopics.get(topicId);
        const practiceCount = practice?.practiceCount ?? 0;
        const correctCount = practice?.correctCount ?? 0;
        const accuracy = practiceCount > 0 ? Math.round((correctCount / practiceCount) * 100) : 0;

        return {
          topicId,
          topicName: topicNameMap.get(topicId) ?? 'Unknown',
          flashcardCount: fcSet.size,
          practiceCount,
          accuracy,
        };
      })
      .filter((t) => t.flashcardCount > 0)
      .sort((a, b) => b.practiceCount - a.practiceCount);

    const pairAccuracy = new Map<string, { correct: number; total: number }>();
    for (const row of practiceRows ?? []) {
      const key = `${row.flashcard_id}:${row.user_id}`;
      const entry = pairAccuracy.get(key) ?? { correct: 0, total: 0 };
      entry.total++;
      if (row.was_correct) entry.correct++;
      pairAccuracy.set(key, entry);
    }

    let easyCount = 0;
    let mediumCount = 0;
    let hardCount = 0;
    for (const entry of pairAccuracy.values()) {
      const rate = entry.correct / entry.total;
      if (rate >= 0.8) easyCount++;
      else if (rate >= 0.5) mediumCount++;
      else hardCount++;
    }

    const practicedFlashcardIds = new Set((practiceRows ?? []).map((p) => p.flashcard_id));
    const newCount = filteredFlashcardIds.filter((id) => !practicedFlashcardIds.has(id)).length;

    return {
      summary: {
        totalDecks: byDeck.length,
        totalFlashcards: filteredFlashcardIds.length,
        totalPractices,
        totalStudents: uniqueStudents,
        overallAccuracy,
        averageEasinessFactor: avgEF,
        difficultyBreakdown: {
          easy: easyCount,
          medium: mediumCount,
          hard: hardCount,
          new: newCount,
        },
      },
      byDeck: byDeck.sort((a, b) => b.practiceCount - a.practiceCount),
      byTopic,
    };
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
