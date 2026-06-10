import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';
import { flashcardSpacedRepetitionService } from './flashcard-spaced-repetition.service';
import type { BatchPracticeInput } from '@/server/models';
import { buildQueryFilter, Permission } from '@/lib/rbac';

export class FlashcardPracticeService {
  async log(
    flashcardId: string,
    wasCorrect: boolean,
    ctx: RequestContext,
    responseTimeMs?: number,
    confidenceLevel?: number,
    sessionId?: string,
  ) {
    const supabase = await createClient();

    const { data: practice, error } = await supabase
      .from('flashcard_practice')
      .insert({
        user_id: ctx.userId,
        flashcard_id: flashcardId,
        was_correct: wasCorrect,
        response_time_ms: responseTimeMs ?? null,
        confidence_level: confidenceLevel ?? null,
        session_id: sessionId ?? null,
      })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);

    const reviewState = await this.upsertReviewState(flashcardId, wasCorrect, confidenceLevel, ctx);

    return {
      practice,
      reviewState,
    };
  }

  async batch(data: BatchPracticeInput, ctx: RequestContext) {
    const supabase = await createClient();
    let updated = 0;

    for (const item of data.items) {
      const { error: practiceError } = await supabase
        .from('flashcard_practice')
        .insert({
          user_id: ctx.userId,
          flashcard_id: item.flashcardId,
          was_correct: item.wasCorrect,
          confidence_level: item.confidenceLevel ?? null,
          session_id: item.sessionId ?? null,
        });

      if (practiceError) {
        continue;
      }

      try {
        await this.upsertReviewState(item.flashcardId, item.wasCorrect, item.confidenceLevel, ctx);
        updated++;
      } catch {
        // skip individual failures
      }
    }

    return { success: true, updated };
  }

  private async getReviewState(flashcardId: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data } = await supabase
      .from('flashcard_review_state')
      .select('*')
      .eq('user_id', ctx.userId)
      .eq('flashcard_id', flashcardId)
      .maybeSingle();

    return data;
  }

  private async upsertReviewState(
    flashcardId: string,
    wasCorrect: boolean,
    confidenceLevel: number | undefined,
    ctx: RequestContext,
  ) {
    const supabase = await createClient();

    const existing = await this.getReviewState(flashcardId, ctx);

    const currentEF = existing?.easiness_factor ?? 2.5;
    const currentInterval = existing?.interval_days ?? 0;
    const currentRepetitions = existing?.repetitions ?? 0;

    const result = flashcardSpacedRepetitionService.calculateNextReview({
      wasCorrect,
      confidenceLevel,
      currentEF,
      currentInterval,
      currentRepetitions,
    });

    const quality = !wasCorrect
      ? confidenceLevel != null ? Math.min(confidenceLevel - 1, 2) : 0
      : confidenceLevel ?? 4;

    const { data: reviewState, error } = await supabase
      .from('flashcard_review_state')
      .upsert({
        user_id: ctx.userId,
        flashcard_id: flashcardId,
        easiness_factor: result.newEF,
        interval_days: result.newInterval,
        repetitions: result.newRepetitions,
        next_review_at: result.nextReviewAt.toISOString(),
        last_reviewed_at: new Date().toISOString(),
        last_quality: quality,
      }, {
        onConflict: 'user_id, flashcard_id',
      })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    return reviewState;
  }

  async getDueCards(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
    limit: number = 20,
  ) {
    const supabase = await createClient();

    const matchingIds = await this.getMatchingFlashcardIds(ctx, filters);
    if (matchingIds.length === 0) return [];

    const { data: states } = await supabase
      .from('flashcard_review_state')
      .select('*')
      .eq('user_id', ctx.userId)
      .in('flashcard_id', matchingIds);

    const stateByCard = new Map((states ?? []).map((s) => [s.flashcard_id, s]));

    const { data: flashcards, error } = await supabase
      .from('flashcards')
      .select('id, front, back, created_at')
      .in('id', matchingIds);

    if (error) throw mapSupabaseError(error);

    const now = new Date();
    const due: NonNullable<typeof flashcards> = [];
    const notDue: NonNullable<typeof flashcards> = [];

    for (const fc of flashcards ?? []) {
      const state = stateByCard.get(fc.id);
      if (!state || new Date(state.next_review_at) <= now) {
        due.push(fc);
      } else {
        notDue.push(fc);
      }
    }

    type FlashcardRow = NonNullable<typeof flashcards>[number];
    const mapCard = (fc: FlashcardRow) => ({
      id: fc.id,
      front: fc.front,
      back: fc.back,
      createdAt: fc.created_at,
      reviewState: stateByCard.get(fc.id) ?? null,
    });

    if (due.length > 0) {
      due.sort((a, b) => {
        const sa = stateByCard.get(a.id);
        const sb = stateByCard.get(b.id);
        if (!sa && !sb) return 0;
        if (!sa) return -1;
        if (!sb) return 1;
        return new Date(sa.next_review_at).getTime() - new Date(sb.next_review_at).getTime();
      });

      return due.slice(0, limit).map(mapCard);
    }

    notDue.sort((a, b) => {
      const sa = stateByCard.get(a.id);
      const sb = stateByCard.get(b.id);
      const qa = sa?.last_quality ?? 999;
      const qb = sb?.last_quality ?? 999;
      return qa - qb;
    });

    return notDue.slice(0, limit).map(mapCard);
  }

  async getDueBreakdown(ctx: RequestContext) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    let query = supabase
      .from('flashcards')
      .select('id');

    if (filter._impossible) return { total: 0, byTopic: {}, byDeck: {} };
    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    const { data: flashcards, error } = await query;
    if (error) throw mapSupabaseError(error);

    if (!flashcards || flashcards.length === 0) {
      return { total: 0, byTopic: {}, byDeck: {} };
    }

    const flashcardIds = flashcards.map((fc) => fc.id);
    const now = new Date();

    const { data: states } = await supabase
      .from('flashcard_review_state')
      .select('flashcard_id, next_review_at')
      .eq('user_id', ctx.userId)
      .in('flashcard_id', flashcardIds);

    const stateByCard = new Map((states ?? []).map((s) => [s.flashcard_id, s]));
    const dueFlashcardIds = flashcardIds.filter((fcId) => {
      const state = stateByCard.get(fcId);
      return !state || new Date(state.next_review_at) <= now;
    });

    if (dueFlashcardIds.length === 0) {
      return { total: 0, byTopic: {}, byDeck: {} };
    }

    const { data: topicAssignments } = await supabase
      .from('flashcard_topic_assignments')
      .select('flashcard_id, topic_id')
      .in('flashcard_id', dueFlashcardIds);

    const { data: deckAssignments } = await supabase
      .from('flashcard_deck_assignments')
      .select('flashcard_id, deck_id')
      .in('flashcard_id', dueFlashcardIds);

    const byTopic: Record<string, number> = {};
    for (const a of topicAssignments ?? []) {
      byTopic[a.topic_id] = (byTopic[a.topic_id] ?? 0) + 1;
    }

    const byDeck: Record<string, number> = {};
    for (const a of deckAssignments ?? []) {
      byDeck[a.deck_id] = (byDeck[a.deck_id] ?? 0) + 1;
    }

    return { total: dueFlashcardIds.length, byTopic, byDeck };
  }

  async getDueCount(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
  ) {
    const supabase = await createClient();

    const matchingIds = await this.getMatchingFlashcardIds(ctx, filters);
    if (matchingIds.length === 0) return { count: 0 };

    const { data: states } = await supabase
      .from('flashcard_review_state')
      .select('flashcard_id, next_review_at')
      .eq('user_id', ctx.userId)
      .in('flashcard_id', matchingIds);

    const stateByCard = new Map((states ?? []).map((s) => [s.flashcard_id, s]));

    const { data: flashcards } = await supabase
      .from('flashcards')
      .select('id')
      .in('id', matchingIds);

    const now = new Date();
    const count = (flashcards ?? []).filter((fc) => {
      const state = stateByCard.get(fc.id);
      return !state || new Date(state.next_review_at) <= now;
    }).length;

    return { count };
  }

  async getStatsAll(ctx: RequestContext) {
    const supabase = await createClient();

    const { count: totalPracticed, error: countError } = await supabase
      .from('flashcard_practice')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', ctx.userId);

    if (countError) throw mapSupabaseError(countError);

    const { data: stateRows } = await supabase
      .from('flashcard_review_state')
      .select('*')
      .eq('user_id', ctx.userId);

    const now = new Date();
    const totalDue = (stateRows ?? []).filter(
      (s) => new Date(s.next_review_at) <= now,
    ).length;

    const avgEF =
      stateRows && stateRows.length > 0
        ? stateRows.reduce((sum, s) => sum + s.easiness_factor, 0) / stateRows.length
        : 0;

    return {
      totalPracticed: totalPracticed ?? 0,
      totalDue,
      totalCardsReviewed: stateRows?.length ?? 0,
      averageEasinessFactor: Math.round(avgEF * 100) / 100,
    };
  }

  async getStatsForFlashcard(flashcardId: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: attempts, error } = await supabase
      .from('flashcard_practice')
      .select('*')
      .eq('flashcard_id', flashcardId)
      .eq('user_id', ctx.userId)
      .order('practiced_at', { ascending: false });

    if (error) throw mapSupabaseError(error);

    const reviewState = await this.getReviewState(flashcardId, ctx);

    const totalAttempts = attempts?.length ?? 0;
    const correctAttempts = (attempts ?? []).filter((a) => a.was_correct).length;
    const avgResponseTime = (attempts ?? []).reduce((sum, a) => sum + (a.response_time_ms ?? 0), 0) / (totalAttempts || 1);

    return {
      totalAttempts,
      correctRate: totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0,
      averageResponseTimeMs: Math.round(avgResponseTime),
      reviewState,
    };
  }

  private async getMatchingFlashcardIds(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
  ): Promise<string[]> {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    let query = supabase
      .from('flashcards')
      .select('id');

    if (filter._impossible) return [];
    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    if (filters.topicIds && filters.topicIds.length > 0) {
      const { data: assignments } = await supabase
        .from('flashcard_topic_assignments')
        .select('flashcard_id')
        .in('topic_id', filters.topicIds);

      const topicCardIds = [...new Set(assignments?.map((a) => a.flashcard_id) ?? [])];
      if (topicCardIds.length === 0) return [];
      query = query.in('id', topicCardIds);
    }

    if (filters.deckIds && filters.deckIds.length > 0) {
      const { data: assignments } = await supabase
        .from('flashcard_deck_assignments')
        .select('flashcard_id')
        .in('deck_id', filters.deckIds);

      const deckCardIds = [...new Set(assignments?.map((a) => a.flashcard_id) ?? [])];
      if (deckCardIds.length === 0) return [];
      query = query.in('id', deckCardIds);
    }

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);
    return (data ?? []).map((r) => r.id);
  }
}

export const flashcardPracticeService = new FlashcardPracticeService();
