import { ORG_LIMIT_KEYS, USER_LIMIT_KEYS } from '@studiq/server/services/limit.catalog';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { POST as createFlashcardPost } from '@/app/(backend)/api/v1/flashcards/route';

// Issue #233 (option A): in an org context a content limit counts only the
// caller's content **in that org**. Personal-space cards must not consume the
// org plan's per-member capacity — otherwise joining an org would retroactively
// charge a member for personal content created before they joined.
const CARD_LIMIT = 1;

interface ApiResponse {
  status: number;
  body: { success?: boolean; data?: unknown; error?: string };
}

async function postCard(front: string, orgId: string, deckId: string): Promise<ApiResponse> {
  const req = createNextRequest(
    'http://localhost/api/v1/flashcards',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ front, back: 'A', deckId: deckId }),
    },
    { active_org_id: orgId },
  );
  const response = await createFlashcardPost(req);
  return { status: response.status, body: await response.json() };
}

forEachCopy((copyId) => {
  describe(`Org-context limit count scope [${copyId}]`, () => {
    registerMock(copyId, null);

    let service!: SupabaseClient;
    let fixture!: BeforeResult;
    let orgPlanKey!: string;
    let personalDeckId!: string;
    let orgDeckId!: string;

    beforeAll(async () => {
      service = createServiceClient();
      fixture = await before({ role: 'manager', org: true });
      orgPlanKey = `test-count-233-${copyId}-${Date.now().toString(36)}`;

      const { error: planError } = await service.from('subscription_plans').insert({
        key: orgPlanKey,
        name: `Test count scope ${copyId}`,
        price_monthly: 0,
        currency: 'PLN',
        sort_order: 998,
        for_account_type: 'manager',
        is_active: false,
      });
      if (planError) throw new Error(`[count-scope] plan create failed: ${planError.message}`);

      const rows = [
        ...USER_LIMIT_KEYS.map((key) => ({
          plan_key: orgPlanKey,
          limit_key: key,
          limit_value: key === 'max_flashcards' ? CARD_LIMIT : 100,
        })),
        ...ORG_LIMIT_KEYS.map((key) => ({
          plan_key: orgPlanKey,
          limit_key: key,
          limit_value: 5,
        })),
      ];
      const { error: limitsError } = await service.from('plan_limits').insert(rows);
      if (limitsError) {
        throw new Error(`[count-scope] plan limits create failed: ${limitsError.message}`);
      }

      // `flashcards.deck_id` is NOT NULL, so both the personal-space and the
      // org-space card need a deck. Inserted directly: decks are not the limit
      // under test.
      const { data: decks, error: decksError } = await service
        .from('flashcard_decks')
        .insert([
          {
            name: `personal-deck-${copyId}`,
            created_by: fixture.user.id,
            organization_id: null,
          },
          {
            name: `org-deck-${copyId}`,
            created_by: fixture.user.id,
            organization_id: fixture.orgId,
          },
        ])
        .select('id, organization_id');
      if (decksError || !decks) {
        throw new Error(`[count-scope] deck create failed: ${decksError?.message}`);
      }
      personalDeckId = decks.find((deck) => deck.organization_id === null)!.id;
      orgDeckId = decks.find((deck) => deck.organization_id === fixture.orgId)!.id;
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
      mockUser(fixture.user);
      await service.from('organizations').update({ plan: orgPlanKey }).eq('id', fixture.orgId!);
      // Start every case from a clean slate: one personal-space card, no org cards.
      await service.from('flashcards').delete().eq('created_by', fixture.user.id);
      const { error } = await service.from('flashcards').insert({
        front: `personal-${copyId}`,
        back: 'A',
        created_by: fixture.user.id,
        organization_id: null,
        deck_id: personalDeckId,
      });
      if (error) throw new Error(`[count-scope] personal card create failed: ${error.message}`);
    });

    afterAll(async () => {
      await service.from('flashcards').delete().eq('created_by', fixture.user.id);
      await service.from('flashcard_decks').delete().eq('created_by', fixture.user.id);
      if (fixture?.orgId) await cleanupOrganizationDeep(fixture.orgId);
      await service.from('plan_limits').delete().eq('plan_key', orgPlanKey);
      await service.from('subscription_plans').delete().eq('key', orgPlanKey);
    });

    async function countFor(organizationId: string | null): Promise<number> {
      let query = service
        .from('flashcards')
        .select('*', { count: 'exact', head: true })
        .eq('created_by', fixture.user.id);
      query =
        organizationId === null
          ? query.is('organization_id', null)
          : query.eq('organization_id', organizationId);
      const { count } = await query;
      return count ?? 0;
    }

    it('does not count personal-space cards against the org plan capacity', async () => {
      expect(await countFor(null)).toBe(1);
      expect(await countFor(fixture.orgId!)).toBe(0);

      // CARD_LIMIT = 1: the personal card must not consume the slot.
      const first = await postCard(`org-a-${copyId}`, fixture.orgId!, orgDeckId);
      expect(first.status).toBe(201);

      // The limit then applies to org-owned content.
      const second = await postCard(`org-b-${copyId}`, fixture.orgId!, orgDeckId);
      expect(second.status).toBe(429);
      expect(second.body.success).toBe(false);
      expect(second.body.error).toBe('USAGE_LIMIT_EXCEEDED');

      expect(await countFor(fixture.orgId!)).toBe(CARD_LIMIT);
      expect(await countFor(null)).toBe(1);
    });
  });
});
