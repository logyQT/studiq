import type { SupabaseClient } from '@supabase/supabase-js';
import { buildQueryFilter, Permission } from '@/lib/authz';
import { wrapService } from '@/lib/observability';
import type { RequestContext } from '@/lib/request-context';
import { type ServiceResult, success } from '@/lib/service-result';
import { createClient } from '@/lib/supabase/server';
import { toDbFailure } from '@/lib/supabase-errors';
import type {
  BatchPracticeInput,
  CardStatsItem,
  CompleteSessionInput,
  DueBreakdownResponse,
  DueCountResponse,
  DueFlashcardItem,
  FlashcardRow,
  PracticeSummary,
} from '@/server/models/flashcard-practice.model';
import type { Rating } from '@/server/models/flashcard-spaced-repetition.model';
import { flashcardSpacedRepetitionService } from '@/server/services/flashcard-spaced-repetition.service';

export class FlashcardPracticeService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async log(
    flashcardId: string,
    wasCorrect: boolean,
    ctx: RequestContext,
    responseTimeMs?: number,
    confidenceLevel?: number,
    sessionId?: string,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

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

    if (error) return toDbFailure(error);

    const reviewStateResult = await this.upsertReviewState(
      flashcardId,
      wasCorrect,
      confidenceLevel,
      ctx,
    );
    if (!reviewStateResult.success) return reviewStateResult;

    return success({
      practice,
      reviewState: reviewStateResult.data as any,
    });
  }

  async batch(data: BatchPracticeInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const results: Array<{ flashcardId: string; isLeech: boolean }> = [];

    for (const item of data.items) {
      const { error: practiceError } = await supabase.from('flashcard_practice').insert({
        user_id: ctx.userId,
        flashcard_id: item.flashcardId,
        was_correct: item.wasCorrect,
        confidence_level: item.confidenceLevel ?? null,
        session_id: item.sessionId ?? null,
      });

      if (practiceError) return toDbFailure(practiceError);

      const reviewStateResult = await this.upsertReviewState(
        item.flashcardId,
        item.wasCorrect,
        item.confidenceLevel,
        ctx,
      );
      if (!reviewStateResult.success) return reviewStateResult;
      results.push({
        flashcardId: item.flashcardId,
        isLeech: (reviewStateResult.data as any).is_leech,
      });
    }

    return success({ success: true, results });
  }

  private async getReviewState(
    flashcardId: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data } = await supabase
      .from('flashcard_review_state')
      .select('*')
      .eq('user_id', ctx.userId)
      .eq('flashcard_id', flashcardId)
      .maybeSingle();

    return success(data);
  }

  private async ensureStudySettings(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: existing } = await supabase
      .from('user_study_settings')
      .select('*')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (existing) return success(existing);

    const { data: created, error } = await supabase
      .from('user_study_settings')
      .insert({ user_id: ctx.userId })
      .select()
      .single();

    if (error) return toDbFailure(error);
    return success(created);
  }

  private async resetDailyIfNeeded(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const settingsResult = await this.ensureStudySettings(ctx);
    if (!settingsResult.success) return settingsResult;
    const settings = settingsResult.data as any;

    const today = new Date().toISOString().split('T')[0];
    if (settings.daily_reset_date < today) {
      const { data: updated, error } = await supabase
        .from('user_study_settings')
        .update({ new_cards_introduced: 0, daily_reset_date: today })
        .eq('user_id', ctx.userId)
        .select()
        .single();

      if (error) return toDbFailure(error);
      return success(updated);
    }

    return success(settings);
  }

  async getSettings(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const settingsResult = await this.resetDailyIfNeeded(ctx);
    if (!settingsResult.success) return settingsResult;
    const settings = settingsResult.data as any;
    const budget = Math.max(0, settings.new_cards_per_day - settings.new_cards_introduced);
    const actualNew = await this.countNewCards(ctx);
    return success({
      learningSteps: settings.learning_steps,
      newCardsPerDay: settings.new_cards_per_day,
      newCardsIntroduced: settings.new_cards_introduced,
      leechThreshold: settings.leech_threshold,
      dailyResetDate: settings.daily_reset_date,
      remainingNewCards: Math.min(budget, actualNew),
      totalNewCards: actualNew,
      dailyReviewGoal: settings.daily_review_goal ?? 0,
    });
  }

  private async countNewCards(ctx: RequestContext): Promise<number> {
    const filter = buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return 0;

    const { filterType, organizationId } = resolveFilterType(filter, ctx);

    const supabase = await this.createClient();
    const { data, error } = await supabase.rpc('count_new_cards', {
      p_user_id: ctx.userId,
      p_filter_type: filterType,
      p_organization_id: organizationId,
    });

    if (error) return 0;
    return (data as number) ?? 0;
  }

  private async upsertReviewState(
    flashcardId: string,
    _wasCorrect: boolean,
    confidenceLevel: number | undefined,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const existingResult = await this.getReviewState(flashcardId, ctx);
    if (!existingResult.success) return existingResult;
    const existing = existingResult.data as any;
    const settingsResult = await this.resetDailyIfNeeded(ctx);
    if (!settingsResult.success) return settingsResult;
    const settings = settingsResult.data as any;

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

    if (error) return toDbFailure(error);

    if (!existing) {
      const { error: introError } = await supabase
        .from('user_study_settings')
        .update({ new_cards_introduced: settings.new_cards_introduced + 1 })
        .eq('user_id', ctx.userId);
      if (introError) return toDbFailure(introError);
    }

    return success(reviewState);
  }

  async getDueCards(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
    limit: number = 20,
    newOnly: boolean = false,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return success([]);

    const { filterType, organizationId } = resolveFilterType(filter, ctx);

    const settingsResult = await this.resetDailyIfNeeded(ctx);
    if (!settingsResult.success) return settingsResult;
    const settings = settingsResult.data as any;
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

    if (rpcError) return toDbFailure(rpcError);
    const cards = (rpcResult as unknown as DueFlashcardItem[]) ?? [];

    return success(cards);
  }

  async getDueBreakdown(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible)
      return success({ total: 0, nextReviewAt: null, byTopic: {}, byDeck: {} });

    const { data, error } = await supabase.rpc('get_due_breakdown', {
      p_user_id: ctx.userId,
      p_created_by: filter.created_by ?? null,
      p_organization_id: ctx.activeOrgId ?? null,
      p_topic_ids: null,
      p_deck_ids: null,
    });

    if (error) return toDbFailure(error);

    const rpcResult = data as DueBreakdownResponse;

    const byTopic: Record<string, number> = {};
    for (const t of rpcResult.byTopic ?? []) byTopic[t.topic_id] = t.count;

    const byDeck: Record<string, number> = {};
    for (const d of rpcResult.byDeck ?? []) byDeck[d.deck_id] = d.count;

    return success({
      total: rpcResult.total,
      nextReviewAt: rpcResult.nextReviewAt,
      byTopic,
      byDeck,
    });
  }

  async getDueCount(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const rbac = buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (rbac._impossible) return success({ count: 0 });

    const { data, error } = await supabase.rpc('get_due_breakdown', {
      p_user_id: ctx.userId,
      p_created_by: rbac.created_by ?? null,
      p_organization_id: ctx.activeOrgId ?? null,
      p_topic_ids: filters.topicIds?.length ? filters.topicIds : null,
      p_deck_ids: filters.deckIds?.length ? filters.deckIds : null,
    });

    if (error) return toDbFailure(error);
    return success({ count: (data as DueCountResponse).total });
  }

  async getStatsAll(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
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
    if (countError) return toDbFailure(countError);

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

    return success({
      totalPracticed: totalPracticed ?? 0,
      totalDue,
      totalCardsReviewed: filteredStates.length,
      averageEasinessFactor: Math.round(avgEF * 100) / 100,
    });
  }

  async getStateBreakdown(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');

    if (filter._impossible) {
      return success({
        totalCards: 0,
        neverPracticed: 0,
        learning: 0,
        review: 0,
        relearning: 0,
        leeched: 0,
      });
    }

    const { data, error } = await supabase.rpc('get_practice_state_breakdown', {
      p_user_id: ctx.userId,
      p_created_by: filter.created_by ?? null,
      p_organization_id: ctx.activeOrgId ?? null,
    });

    if (error) {
      return success({
        totalCards: 0,
        neverPracticed: 0,
        learning: 0,
        review: 0,
        relearning: 0,
        leeched: 0,
      });
    }

    return success(
      data as {
        totalCards: number;
        neverPracticed: number;
        learning: number;
        review: number;
        relearning: number;
        leeched: number;
      },
    );
  }

  async getStatsForFlashcard(
    flashcardId: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: attempts, error } = await supabase
      .from('flashcard_practice')
      .select('*')
      .eq('flashcard_id', flashcardId)
      .eq('user_id', ctx.userId)
      .order('practiced_at', { ascending: false });

    if (error) return toDbFailure(error);

    const reviewStateResult = await this.getReviewState(flashcardId, ctx);
    if (!reviewStateResult.success) return reviewStateResult;

    const totalAttempts = attempts?.length ?? 0;
    const correctAttempts = (attempts ?? []).filter((a) => a.was_correct).length;
    const avgResponseTime =
      (attempts ?? []).reduce((sum, a) => sum + (a.response_time_ms ?? 0), 0) /
      (totalAttempts || 1);

    return success({
      totalAttempts,
      correctRate: totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0,
      averageResponseTimeMs: Math.round(avgResponseTime),
      reviewState: reviewStateResult.data,
    });
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
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const cardFilter = buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    const suspendedCardIds = await this.getSuspendedCardIds(ctx);

    let query = supabase.from('flashcards').select('id, front, back, created_at');

    if (cardFilter._impossible) return success({ items: [], nextCursor: null, hasMore: false });
    if (cardFilter.organization_id) {
      query = query.eq('organization_id', cardFilter.organization_id);
    }
    if (cardFilter.created_by) {
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
    if (error) return toDbFailure(error);

    const rows = (flashcards ?? []) as Array<{
      id: string;
      front: string;
      back: string;
      created_at: string;
    }>;
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;

    if (page.length === 0) return success({ items: [], nextCursor: null, hasMore: false });

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

    const practiceByCard = new Map<string, PracticeSummary>();
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

    return success({ items, nextCursor, hasMore });
  }

  private async getMatchingFlashcardIds(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
  ): Promise<string[]> {
    const supabase = await this.createClient();

    const filter = buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    let query = supabase.from('flashcards').select('id');

    if (filter._impossible) return [];
    if (filter.organization_id) {
      query = query.eq('organization_id', filter.organization_id);
    }
    if (filter.created_by) {
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
      query = query.in('deck_id', filters.deckIds);
    }

    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map((r) => r.id);
  }

  private async getSuspendedCardIds(ctx: RequestContext): Promise<string[]> {
    const supabase = await this.createClient();

    const { data: suspendedDecks } = await supabase
      .from('suspended_decks')
      .select('deck_id')
      .eq('user_id', ctx.userId);

    const deckIds = (suspendedDecks ?? []).map((s) => s.deck_id);
    if (deckIds.length === 0) return [];

    const { data: flashcards } = await supabase
      .from('flashcards')
      .select('id')
      .in('deck_id', deckIds);

    return [...new Set((flashcards ?? []).map((f) => f.id))];
  }

  async completeSession(
    data: CompleteSessionInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

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

    if (error) return toDbFailure(error);

    return success(undefined);
  }

  async getCardsForPractice(
    ctx: RequestContext,
    filters: { deckIds?: string[]; topicIds?: string[] },
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return success([]);

    const matchingIds = await this.getMatchingFlashcardIds(ctx, filters);

    if (matchingIds.length === 0) return success([]);

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
        'id, front, back, created_at, deck_id, flashcard_topic_assignments(topic_id, topics(name))',
      )
      .in('id', matchingIds);
    if (error) return toDbFailure(error);

    return success(
      (flashcards ?? []).map((fc: FlashcardRow) => {
        const state = stateByCard.get(fc.id);
        return {
          id: fc.id,
          front: fc.front,
          back: fc.back,
          createdAt: fc.created_at ?? null,
          deckName: fc.deck_name ?? null,
          topicNames:
            fc.flashcard_topic_assignments?.flatMap((a) => {
              const name = a.topics?.[0]?.name;
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
      }),
    );
  }
}

/**
 * Maps the compound filter from buildQueryFilter to the RPC
 * parameter format expected by practice functions.
 *
 *   visibility = 'group'  → university scope (shared group content)
 *   created_by present   → own scope (user's content in current org)
 *   empty filter         → any scope (no filtering)
 */
function resolveFilterType(
  filter: Record<string, unknown>,
  ctx: RequestContext,
): { filterType: string; organizationId: string | null } {
  if (filter._useRpc) {
    return { filterType: 'university', organizationId: ctx.activeOrgId ?? null };
  }
  if (filter.created_by) {
    return { filterType: 'own', organizationId: ctx.activeOrgId ?? null };
  }
  return { filterType: 'any', organizationId: null };
}
export const flashcardPracticeService = wrapService(
  new FlashcardPracticeService(createClient),
  'flashcard-practice.service',
);
