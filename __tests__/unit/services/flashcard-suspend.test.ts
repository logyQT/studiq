import { AccountType, type RequestContext } from '@studiq/authz';
import { check } from '@studiq/server/lib/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { FlashcardService } from '@studiq/server/services/flashcard.service';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/lib/authz', () => ({
  check: vi.fn().mockResolvedValue(undefined),
  accessibleFilter: vi.fn().mockResolvedValue({}),
  can: vi.fn().mockResolvedValue(true),
  Permission: {
    FLASHCARD_READ: 'flashcard.read',
    FLASHCARD_UPDATE: 'flashcard.update',
    FLASHCARD_DELETE: 'flashcard.delete',
    TOPIC_READ: 'topic.read',
    DECK_UPDATE: 'deck.update',
  },
}));

vi.mock('@studiq/server/services/limits', () => ({
  limitsResolver: { checkLimit: vi.fn().mockResolvedValue(undefined) },
}));

const ctx: RequestContext = {
  userId: 'test-user-id',
  accountType: AccountType.STUDENT,
  traceId: 't',
  url: 'http://localhost',
  method: 'PUT',
  activeOrgId: null,
  orgRoleId: null,
  groupIds: [],
  permissionScopes: {},
};

const card = {
  id: 'fc-1',
  front: 'front',
  back: 'back',
  created_by: ctx.userId,
  organization_id: null,
  visibility: 'personal' as const,
  deck_id: null,
  question_id: null,
};

type QueryResult = { data: unknown; error: unknown };

interface Chain {
  select: Mock;
  eq: Mock;
  in: Mock;
  or: Mock;
  order: Mock;
  limit: Mock;
  filter: Mock;
  insert: Mock;
  update: Mock;
  delete: Mock;
  upsert: Mock;
  single: Mock;
  maybeSingle: Mock;
  then: Promise<QueryResult>['then'];
}

function builder(result: QueryResult): Chain {
  const promise = Promise.resolve(result);
  const c: Chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    filter: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: promise.then.bind(promise),
  };
  for (const method of [
    c.select,
    c.eq,
    c.in,
    c.or,
    c.order,
    c.limit,
    c.filter,
    c.insert,
    c.update,
    c.delete,
    c.upsert,
  ]) {
    method.mockImplementation(() => c);
  }
  return c;
}

function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

describe('FlashcardService suspension', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const service = new FlashcardService(() => Promise.resolve(mock));

  let flashcards: Chain;
  let suspensions: Chain;
  let reviewStates: Chain;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    flashcards = builder({ data: card, error: null });
    suspensions = builder({ data: null, error: null });
    reviewStates = builder({ data: null, error: null });

    mock.from.mockImplementation((table: string) => {
      if (table === 'flashcards') return flashcards;
      if (table === 'suspended_cards') return suspensions;
      if (table === 'flashcard_review_state') return reviewStates;
      return builder({ data: null, error: null });
    });
  });

  it('suspends with read access only and writes suspended_cards', async () => {
    const result = expectSuccess(await service.update('fc-1', { suspended: true }, ctx));

    expect(result).toMatchObject({ id: 'fc-1' });
    expect(check).toHaveBeenCalledWith(ctx, 'flashcard.read', card);
    expect(suspensions.upsert).toHaveBeenCalledWith(
      { user_id: ctx.userId, flashcard_id: 'fc-1', reason: 'manual' },
      { onConflict: 'user_id, flashcard_id', ignoreDuplicates: true },
    );
    // A suspend-only body must not run an empty content update.
    expect(flashcards.update).not.toHaveBeenCalled();
    expect(reviewStates.update).not.toHaveBeenCalled();
  });

  it('restores by deleting the suspension and resetting the review state', async () => {
    await service.update('fc-1', { suspended: false }, ctx);

    expect(check).toHaveBeenCalledWith(ctx, 'flashcard.read', card);
    expect(suspensions.delete).toHaveBeenCalled();
    expect(reviewStates.update).toHaveBeenCalledWith({
      sm2_lapse_count: 0,
      leech_stage: 0,
      is_leech: false,
      leech_rest_until: null,
    });
    expect(flashcards.update).not.toHaveBeenCalled();
  });

  it('still requires write access for a content update', async () => {
    await service.update('fc-1', { front: 'edited' }, ctx);

    expect(check).toHaveBeenCalledWith(ctx, 'flashcard.update', card);
    expect(suspensions.upsert).not.toHaveBeenCalled();
    expect(suspensions.delete).not.toHaveBeenCalled();
  });

  it('requires write access for a mixed body that also suspends', async () => {
    await service.update('fc-1', { front: 'edited', suspended: true }, ctx);

    expect(check).toHaveBeenCalledWith(ctx, 'flashcard.update', card);
  });
});
