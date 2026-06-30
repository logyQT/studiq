import { log } from '@/lib/logger';
import { buildQueryFilter, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type {
  BatchPracticeInput,
  CompleteSessionInput,
  PracticeCardData,
  Rating,
} from '@/server/models';
import { flashcardSpacedRepetitionService } from './flashcard-spaced-repetition.service';

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
    const results: Array<{ flashcardId: string; isLeech: boolean }> = [];

    for (const item of data.items) {
      const { error: practiceError } = await supabase.from('flashcard_practice').insert({
        user_id: ctx.userId,
        flashcard_id: item.flashcardId,
        was_correct: item.wasCorrect,
        confidence_level: item.confidenceLevel ?? null,
        session_id: item.sessionId ?? null,
      });

      if (practiceError) {
        results.push({ flashcardId: item.flashcardId, isLeech: false });
        continue;
      }

      try {
        const reviewState = await this.upsertReviewState(
          item.flashcardId,
          item.wasCorrect,
          item.confidenceLevel,
          ctx,
        );
        results.push({ flashcardId: item.flashcardId, isLeech: reviewState.is_leech });
      } catch (err) {
        log.system.error(`[batch] upsertReviewState failed for card ${item.flashcardId}`, {
          metadata: { err },
        });
        results.push({ flashcardId: item.flashcardId, isLeech: false });
      }
    }

    return { success: true, results };
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

  private async ensureStudySettings(ctx: RequestContext) {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from('user_study_settings')
      .select('*')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (existing) return existing;

    const { data: created, error } = await supabase
      .from('user_study_settings')
      .insert({ user_id: ctx.userId })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    return created;
  }

  private async resetDailyIfNeeded(ctx: RequestContext) {
    const supabase = await createClient();
    const settings = await this.ensureStudySettings(ctx);

    const today = new Date().toISOString().split('T')[0];
    if (settings.daily_reset_date < today) {
      const { data: updated, error } = await supabase
        .from('user_study_settings')
        .update({ new_cards_introduced: 0, daily_reset_date: today })
        .eq('user_id', ctx.userId)
        .select()
        .single();

      if (error) throw mapSupabaseError(error);
      return updated;
    }

    return settings;
  }

  async getSettings(ctx: RequestContext) {
    const settings = await this.resetDailyIfNeeded(ctx);
    return {
      learningSteps: settings.learning_steps,
      newCardsPerDay: settings.new_cards_per_day,
      newCardsIntroduced: settings.new_cards_introduced,
      leechThreshold: settings.leech_threshold,
      dailyResetDate: settings.daily_reset_date,
      remainingNewCards: Math.max(0, settings.new_cards_per_day - settings.new_cards_introduced),
      dailyReviewGoal: settings.daily_review_goal ?? 0,
    };
  }

  private async upsertReviewState(
    flashcardId: string,
    _wasCorrect: boolean,
    confidenceLevel: number | undefined,
    ctx: RequestContext,
  ) {
    const supabase = await createClient();

    const existing = await this.getReviewState(flashcardId, ctx);
    const settings = await this.resetDailyIfNeeded(ctx);

    const rating = Math.min(Math.max(confidenceLevel ?? 3, 1), 4) as Rating;

    const result = flashcardSpacedRepetitionService.calculateNextReview({
      learningState: existing?.learning_state ?? 'new',
      currentStep: existing?.learning_step ?? 0,
      learningSteps: settings.learning_steps,
      rating,
      easinessFactor: existing?.easiness_factor ?? 2.5,
      interval: existing?.interval_days ?? 0,
      repetitions: existing?.repetitions ?? 0,
      lapseCount: existing?.lapse_count ?? 0,
      leechThreshold: settings.leech_threshold,
    });

    const quality = flashcardSpacedRepetitionService.mapToQuality(rating);

    const { data: reviewState, error } = await supabase
      .from('flashcard_review_state')
      .upsert(
        {
          user_id: ctx.userId,
          flashcard_id: flashcardId,
          easiness_factor: result.newEasinessFactor,
          interval_days: result.newInterval,
          repetitions: result.newRepetitions,
          next_review_at: result.nextReviewAt.toISOString(),
          last_reviewed_at: new Date().toISOString(),
          last_quality: quality,
          learning_state: result.learningState,
          learning_step: result.learningStep,
          lapse_count: result.lapseCount,
          is_leech: result.isLeech,
        },
        {
          onConflict: 'user_id, flashcard_id',
        },
      )
      .select()
      .single();

    if (error) throw mapSupabaseError(error);

    if (!existing) {
      const { error: introError } = await supabase
        .from('user_study_settings')
        .update({ new_cards_introduced: settings.new_cards_introduced + 1 })
        .eq('user_id', ctx.userId);
      if (introError) throw mapSupabaseError(introError);
    }

    return reviewState;
  }

  async getDueCards(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
    limit: number = 20,
    newOnly: boolean = false,
  ) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return [];

    let filterType: string;
    let organizationId: string | null;
    if (filter.or) {
      filterType = 'university';
      organizationId = ctx.activeOrgId ?? null;
    } else if (filter.created_by) {
      filterType = 'own';
      organizationId = null;
    } else {
      filterType = 'any';
      organizationId = null;
    }

    const settings = await this.resetDailyIfNeeded(ctx);
    const newCardLimit = Math.max(0, settings.new_cards_per_day - settings.new_cards_introduced);

    const { data: rpcResult, error: rpcError } = await supabase.rpc('get_due_flashcards', {
      p_user_id: ctx.userId,
      p_filter_type: filterType,
      p_organization_id: organizationId,
      p_limit: newOnly ? Math.min(limit, newCardLimit) : limit,
      p_deck_ids: filters.deckIds?.length ? filters.deckIds : null,
      p_topic_ids: filters.topicIds?.length ? filters.topicIds : null,
      p_new_card_limit: newCardLimit,
      p_new_only: newOnly,
    });

    if (rpcError) throw mapSupabaseError(rpcError);
    const cards =
      (rpcResult as unknown as Array<{
        id: string;
        front: string;
        back: string;
        createdAt: string;
        reviewState: Record<string, unknown> | null;
        deckName: string | null;
        topicNames: string[];
      }>) ?? [];

    return cards;
  }

  async getDueBreakdown(ctx: RequestContext) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return { total: 0, nextReviewAt: null, byTopic: {}, byDeck: {} };

    const { data, error } = await supabase.rpc('get_due_breakdown', {
      p_user_id: ctx.userId,
      p_created_by: filter.created_by ?? (filter.or ? ctx.userId : null),
      p_organization_id: ctx.activeOrgId ?? null,
      p_topic_ids: null,
      p_deck_ids: null,
    });

    if (error) throw mapSupabaseError(error);

    const rpcResult = data as {
      total: number;
      nextReviewAt: string | null;
      byTopic: Array<{ topic_id: string; count: number }>;
      byDeck: Array<{ deck_id: string; count: number }>;
    };

    const byTopic: Record<string, number> = {};
    for (const t of rpcResult.byTopic ?? []) byTopic[t.topic_id] = t.count;

    const byDeck: Record<string, number> = {};
    for (const d of rpcResult.byDeck ?? []) byDeck[d.deck_id] = d.count;

    return { total: rpcResult.total, nextReviewAt: rpcResult.nextReviewAt, byTopic, byDeck };
  }

  async getDueCount(ctx: RequestContext, filters: { topicIds?: string[]; deckIds?: string[] }) {
    const supabase = await createClient();

    const rbac = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (rbac._impossible) return { count: 0 };

    const { data, error } = await supabase.rpc('get_due_breakdown', {
      p_user_id: ctx.userId,
      p_created_by: rbac.created_by ?? (rbac.or ? ctx.userId : null),
      p_organization_id: ctx.activeOrgId ?? null,
      p_topic_ids: filters.topicIds?.length ? filters.topicIds : null,
      p_deck_ids: filters.deckIds?.length ? filters.deckIds : null,
    });

    if (error) throw mapSupabaseError(error);
    return { count: (data as { total: number }).total };
  }

  async getStatsAll(ctx: RequestContext) {
    const supabase = await createClient();
    const suspendedCardIds = await this.getSuspendedCardIds(ctx);

    let practiceQuery = supabase
      .from('flashcard_practice')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', ctx.userId);

    if (suspendedCardIds.length > 0) {
      practiceQuery = practiceQuery.filter(
        'flashcard_id',
        'not.in',
        `(${suspendedCardIds.join(',')})`,
      );
    }

    const { count: totalPracticed, error: countError } = await practiceQuery;
    if (countError) throw mapSupabaseError(countError);

    let stateQuery = supabase.from('flashcard_review_state').select('*').eq('user_id', ctx.userId);

    if (suspendedCardIds.length > 0) {
      stateQuery = stateQuery.filter('flashcard_id', 'not.in', `(${suspendedCardIds.join(',')})`);
    }

    const { data: stateRows } = await stateQuery;
    const filteredStates = stateRows ?? [];

    const now = new Date();
    const totalDue = filteredStates.filter((s) => new Date(s.next_review_at) <= now).length;

    const avgEF =
      filteredStates.length > 0
        ? filteredStates.reduce((sum, s) => sum + s.easiness_factor, 0) / filteredStates.length
        : 0;

    return {
      totalPracticed: totalPracticed ?? 0,
      totalDue,
      totalCardsReviewed: filteredStates.length,
      averageEasinessFactor: Math.round(avgEF * 100) / 100,
    };
  }

  async getStateBreakdown(ctx: RequestContext) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');

    if (filter._impossible) {
      return {
        totalCards: 0,
        neverPracticed: 0,
        learning: 0,
        review: 0,
        relearning: 0,
        leeched: 0,
      };
    }

    const { data, error } = await supabase.rpc('get_practice_state_breakdown', {
      p_user_id: ctx.userId,
      p_created_by: filter.created_by ?? (filter.or ? ctx.userId : null),
      p_organization_id: ctx.activeOrgId ?? null,
    });

    if (error) {
      log.system.error('[getStateBreakdown] RPC failed', { metadata: { error } });
      return {
        totalCards: 0,
        neverPracticed: 0,
        learning: 0,
        review: 0,
        relearning: 0,
        leeched: 0,
      };
    }

    return data as {
      totalCards: number;
      neverPracticed: number;
      learning: number;
      review: number;
      relearning: number;
      leeched: number;
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
    const avgResponseTime =
      (attempts ?? []).reduce((sum, a) => sum + (a.response_time_ms ?? 0), 0) /
      (totalAttempts || 1);

    return {
      totalAttempts,
      correctRate: totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0,
      averageResponseTimeMs: Math.round(avgResponseTime),
      reviewState,
    };
  }

  async getAllCardStats(
    ctx: RequestContext,
    filters?: {
      deckIds?: string[];
      topicIds?: string[];
      state?: string;
      sortBy?: string;
      order?: string;
      limit?: number;
      cursor?: string;
    },
  ) {
    const supabase = await createClient();

    interface CardStatsItem {
      id: string;
      front: string;
      back: string;
      createdAt: string;
      state: string;
      totalAttempts: number;
      correctRate: number;
      lastPracticedAt: string | null;
      easinessFactor: number | null;
      intervalDays: number | null;
      nextReviewAt: string | null;
      repetitions: number | null;
      isLeech: boolean;
      learningStep: number | null;
      lapseCount: number | null;
    }

    const cardFilter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    const suspendedCardIds = await this.getSuspendedCardIds(ctx);

    let query = supabase.from('flashcards').select('id, front, back, created_at');

    if (cardFilter._impossible) return { items: [], nextCursor: null, hasMore: false };
    if (cardFilter.or) {
      query = query.or(cardFilter.or);
    } else if (cardFilter.created_by) {
      query = query.eq('created_by', cardFilter.created_by);
    }

    if (suspendedCardIds.length > 0) {
      query = query.filter('id', 'not.in', `(${suspendedCardIds.join(',')})`);
    }

    const pageSize = Math.min(filters?.limit ?? 50, 100);
    query = query.order('id').limit(pageSize + 1);
    if (filters?.cursor) {
      query = query.gt('id', filters.cursor);
    }

    const { data: flashcards, error } = await query;
    if (error) throw mapSupabaseError(error);

    const rows = (flashcards ?? []) as Array<{
      id: string;
      front: string;
      back: string;
      created_at: string;
    }>;
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;

    if (page.length === 0) return { items: [], nextCursor: null, hasMore: false };

    const flashcardIds = page.map((fc) => fc.id);

    const { data: states } = await supabase
      .from('flashcard_review_state')
      .select('*')
      .eq('user_id', ctx.userId)
      .in('flashcard_id', flashcardIds);

    const stateMap = new Map((states ?? []).map((s) => [s.flashcard_id, s]));

    const { data: practiceRows } = await supabase
      .from('flashcard_practice')
      .select('flashcard_id, was_correct, practiced_at')
      .eq('user_id', ctx.userId)
      .in('flashcard_id', flashcardIds)
      .order('practiced_at', { ascending: false });

    const practiceByCard = new Map<
      string,
      { total: number; correct: number; lastPracticedAt: string | null }
    >();
    for (const row of practiceRows ?? []) {
      const entry = practiceByCard.get(row.flashcard_id) ?? {
        total: 0,
        correct: 0,
        lastPracticedAt: null,
      };
      entry.total++;
      if (row.was_correct) entry.correct++;
      if (!entry.lastPracticedAt) entry.lastPracticedAt = row.practiced_at;
      practiceByCard.set(row.flashcard_id, entry);
    }

    let items = page.map((fc) => {
      const state = stateMap.get(fc.id) ?? null;
      const practice = practiceByCard.get(fc.id);

      const ls = state?.learning_state ?? null;
      const isLeech = state?.is_leech ?? false;
      let stateLabel: string;
      if (!state) stateLabel = 'new';
      else if (isLeech) stateLabel = 'leech';
      else stateLabel = ls ?? 'new';

      return {
        id: fc.id,
        front: fc.front,
        back: fc.back,
        createdAt: fc.created_at,
        state: stateLabel,
        totalAttempts: practice?.total ?? 0,
        correctRate:
          practice && practice.total > 0
            ? Math.round((practice.correct / practice.total) * 100)
            : 0,
        lastPracticedAt: practice?.lastPracticedAt ?? null,
        easinessFactor: state?.easiness_factor ?? null,
        intervalDays: state?.interval_days ?? null,
        nextReviewAt: state?.next_review_at ?? null,
        repetitions: state?.repetitions ?? null,
        isLeech,
        learningStep: state?.learning_step ?? null,
        lapseCount: state?.lapse_count ?? null,
      };
    });

    if (filters?.state) {
      items = items.filter((i) => i.state === filters.state);
    }

    const sortField = (filters?.sortBy ?? 'createdAt') as keyof CardStatsItem;
    const sortOrder = filters?.order === 'asc' ? 1 : -1;
    items.sort((a: CardStatsItem, b: CardStatsItem) => {
      const av = a[sortField] ?? '';
      const bv = b[sortField] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortOrder;
      return String(av).localeCompare(String(bv)) * sortOrder;
    });

    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return { items, nextCursor, hasMore };
  }

  private async getMatchingFlashcardIds(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
  ): Promise<string[]> {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    let query = supabase.from('flashcards').select('id');

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

  private async getSuspendedCardIds(ctx: RequestContext): Promise<string[]> {
    const supabase = await createClient();

    const { data: suspendedDecks } = await supabase
      .from('suspended_decks')
      .select('deck_id')
      .eq('user_id', ctx.userId);

    const deckIds = (suspendedDecks ?? []).map((s) => s.deck_id);
    if (deckIds.length === 0) return [];

    const { data: assignments } = await supabase
      .from('flashcard_deck_assignments')
      .select('flashcard_id')
      .in('deck_id', deckIds);

    return [...new Set((assignments ?? []).map((a) => a.flashcard_id))];
  }

  async completeSession(data: CompleteSessionInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { error } = await supabase.from('flashcard_study_sessions').insert({
      id: data.sessionId,
      user_id: ctx.userId,
      started_at: data.startedAt,
      completed_at: data.completedAt,
      duration_ms: data.durationMs,
      cards_studied: data.cardsStudied,
      cards_correct: data.cardsCorrect,
      deck_ids: data.deckIds ?? [],
      mode: data.mode,
    });

    if (error) throw mapSupabaseError(error);

    return { success: true };
  }

  async getCardsForPractice(
    ctx: RequestContext,
    filters: { deckIds?: string[]; topicIds?: string[] },
  ): Promise<PracticeCardData[]> {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return [];

    const matchingIds = await this.getMatchingFlashcardIds(ctx, filters);

    if (matchingIds.length === 0) return [];

    const { data: reviewStates } = await supabase
      .from('flashcard_review_state')
      .select(
        'flashcard_id, easiness_factor, interval_days, repetitions, next_review_at, last_reviewed_at, last_quality, learning_state, learning_step, lapse_count, is_leech',
      )
      .eq('user_id', ctx.userId)
      .in('flashcard_id', matchingIds);

    const stateByCard = new Map((reviewStates ?? []).map((s) => [s.flashcard_id, s]));

    const { data: flashcards, error } = await supabase
      .from('flashcards')
      .select(
        'id, front, back, created_at, flashcard_deck_assignments(deck_id, flashcard_decks(name)), flashcard_topic_assignments(topic_id, flashcard_topics(name))',
      )
      .in('id', matchingIds);
    if (error) throw mapSupabaseError(error);

    interface FlashcardRow {
      id: string;
      front: string;
      back: string;
      created_at: string;
      flashcard_deck_assignments?: Array<{
        deck_id: string;
        flashcard_decks?: Array<{ name: string }>;
      }>;
      flashcard_topic_assignments?: Array<{
        topic_id: string;
        flashcard_topics?: Array<{ name: string }>;
      }>;
    }

    return (flashcards ?? []).map((fc: FlashcardRow) => {
      const state = stateByCard.get(fc.id);
      return {
        id: fc.id,
        front: fc.front,
        back: fc.back,
        createdAt: fc.created_at ?? null,
        deckName: fc.flashcard_deck_assignments?.[0]?.flashcard_decks?.[0]?.name ?? null,
        topicNames:
          fc.flashcard_topic_assignments?.flatMap((a) => {
            const name = (a.flashcard_topics as unknown as { name: string } | undefined)?.name;
            return name ? [name] : [];
          }) ?? [],
        reviewState: state
          ? {
              easinessFactor: state.easiness_factor,
              intervalDays: state.interval_days,
              repetitions: state.repetitions,
              nextReviewAt: state.next_review_at,
              lastReviewedAt: state.last_reviewed_at,
              lastQuality: state.last_quality,
              learningState: state.learning_state,
              learningStep: state.learning_step,
              lapseCount: state.lapse_count,
              isLeech: state.is_leech,
            }
          : null,
      };
    });
  }
}

export const flashcardPracticeService = new FlashcardPracticeService();
