import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  cleanupFlashcardDecks,
  cleanupFlashcardReviewState,
  cleanupFlashcards,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { POST as createDeckPost } from '@/app/(backend)/api/v1/flashcards/decks/route';
import { GET as getCardsStats } from '@/app/(backend)/api/v1/flashcards/practice/cards-stats/route';
import { GET as getDueBreakdown } from '@/app/(backend)/api/v1/flashcards/practice/due/breakdown/route';
import { GET as getDueCards } from '@/app/(backend)/api/v1/flashcards/practice/new/route';
import { GET as getPrepare } from '@/app/(backend)/api/v1/flashcards/practice/prepare/route';
import { GET as getSettings } from '@/app/(backend)/api/v1/flashcards/practice/settings/route';
import { GET as getStateBreakdown } from '@/app/(backend)/api/v1/flashcards/practice/states/route';
import { POST as createFlashcardPost } from '@/app/(backend)/api/v1/flashcards/route';

/**
 * Regression coverage for the 20260915000008 migration: get_due_flashcards,
 * get_due_breakdown, get_practice_state_breakdown and count_new_cards all
 * treated a group-shared deck as visible to the whole org instead of just
 * the group it was shared with. These tests exercise all four RPCs (three
 * through their real HTTP routes, plus a direct review-state injection to
 * reach the due-breakdown path) with a card shared to one group only, and
 * assert an org member of a *different* group sees none of it.
 */
forEachCopy((copyId) => {
  describe(`Flashcard Practice Group Scoping [${copyId}]`, () => {
    registerMock(copyId, null);

    let teacher!: BeforeResult;
    let groupA!: string;
    let studentInGroupA!: TestUserFixture;
    let studentInGroupB!: TestUserFixture;
    let flashcardId!: string;
    let deckId!: string;
    let ownFlashcardId!: string;
    let outsider!: TestUserFixture;
    let outsiderFlashcardId!: string;

    beforeAll(async () => {
      // A distinct org name (not the "seed-org-" prefix `before()` uses by
      // default) so questions.test.ts's cleanupOrganizationByName('seed-org-')
      // can't race-delete this org out from under a concurrently running copy.
      teacher = await before({
        role: 'educator',
        org: `group-scope-org-${copyId}`,
        groups: 2,
      });
      const orgId = teacher.orgId;
      if (!orgId) throw new Error('[setup] org not created');
      groupA = teacher.groups[1];
      const groupB = teacher.groups[2];

      const service = createServiceClient();
      // The API creates a group without enrolling its creator, so make the
      // teacher a real `teacher` member of groupA — deck group-sharing is only
      // allowed to groups the caller teaches (#140).
      {
        const { error } = await service
          .from('group_members')
          .insert({ group_id: groupA, user_id: teacher.user.id, role: 'teacher' });
        if (error) throw new Error(`[setup] teacher group membership failed: ${error.message}`);
      }
      const { data: memberRole } = await service
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'member')
        .single();
      if (!memberRole) throw new Error('[setup] member org role not found');

      studentInGroupA = await createTestUser({ role: 'student' });
      studentInGroupB = await createTestUser({ role: 'student' });

      for (const student of [studentInGroupA, studentInGroupB]) {
        const { error } = await service
          .from('org_members')
          .insert({ organization_id: orgId, user_id: student.id, org_role_id: memberRole.id });
        if (error) throw new Error(`[setup] org membership failed: ${error.message}`);
      }
      await service
        .from('group_members')
        .insert({ group_id: groupA, user_id: studentInGroupA.id, role: 'member' });
      await service
        .from('group_members')
        .insert({ group_id: groupB, user_id: studentInGroupB.id, role: 'member' });

      mockUser(teacher.user);
      const deckReq = createNextRequest(
        'http://localhost/api/v1/flashcards/decks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `group-scope-deck-${copyId}`,
            visibility: 'group',
            groupIds: [groupA],
          }),
        },
        { active_org_id: orgId },
      );
      const deckRes = await createDeckPost(deckReq);
      const deckBody = await deckRes.json();
      if (!deckRes.ok || !deckBody.success) {
        throw new Error(`[setup] deck creation failed: ${JSON.stringify(deckBody)}`);
      }
      deckId = deckBody.data.id as string;

      const flashcardReq = createNextRequest(
        'http://localhost/api/v1/flashcards',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            front: `group-scope-front-${copyId}`,
            back: `group-scope-back-${copyId}`,
            deckId,
          }),
        },
        { active_org_id: orgId },
      );
      const flashcardRes = await createFlashcardPost(flashcardReq);
      const flashcardBody = await flashcardRes.json();
      if (!flashcardRes.ok || !flashcardBody.success) {
        throw new Error(`[setup] flashcard creation failed: ${JSON.stringify(flashcardBody)}`);
      }
      flashcardId = flashcardBody.data.id as string;

      // #343: a personal deck + card owned by student A. Own-scope content must
      // stay visible to its owner (and only to them).
      mockUser(studentInGroupA);
      const ownDeckRes = await createDeckPost(
        createNextRequest(
          'http://localhost/api/v1/flashcards/decks',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `own-deck-${copyId}`, visibility: 'personal' }),
          },
          { active_org_id: orgId },
        ),
      );
      const ownDeckBody = await ownDeckRes.json();
      if (!ownDeckRes.ok || !ownDeckBody.success) {
        throw new Error(`[setup] own deck creation failed: ${JSON.stringify(ownDeckBody)}`);
      }

      const ownFlashcardRes = await createFlashcardPost(
        createNextRequest(
          'http://localhost/api/v1/flashcards',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              front: `own-front-${copyId}`,
              back: `own-back-${copyId}`,
              deckId: ownDeckBody.data.id,
            }),
          },
          { active_org_id: orgId },
        ),
      );
      const ownFlashcardBody = await ownFlashcardRes.json();
      if (!ownFlashcardRes.ok || !ownFlashcardBody.success) {
        throw new Error(
          `[setup] own flashcard creation failed: ${JSON.stringify(ownFlashcardBody)}`,
        );
      }
      ownFlashcardId = ownFlashcardBody.data.id as string;

      // #343: the S3 shape — a user with NO membership in the org owns a card
      // stamped with the org id. RLS is org-level, so only the app-layer
      // accessible filter can keep it out of other students' views.
      outsider = await createTestUser({ role: 'student' });
      const { data: outsiderDeck, error: outsiderDeckError } = await service
        .from('flashcard_decks')
        .insert({
          name: `outsider-deck-${copyId}`,
          created_by: outsider.id,
          organization_id: orgId,
          visibility: 'personal',
        })
        .select()
        .single();
      if (outsiderDeckError || !outsiderDeck) {
        throw new Error(`[setup] outsider deck failed: ${outsiderDeckError?.message}`);
      }
      const { data: outsiderCard, error: outsiderCardError } = await service
        .from('flashcards')
        .insert({
          front: `outsider-front-${copyId}`,
          back: `outsider-back-${copyId}`,
          created_by: outsider.id,
          organization_id: orgId,
          visibility: 'personal',
          deck_id: outsiderDeck.id,
        })
        .select()
        .single();
      if (outsiderCardError || !outsiderCard) {
        throw new Error(`[setup] outsider card failed: ${outsiderCardError?.message}`);
      }
      outsiderFlashcardId = outsiderCard.id as string;
    });

    afterAll(async () => {
      await cleanupFlashcardReviewState(studentInGroupA.id);
      await cleanupFlashcardReviewState(studentInGroupB.id);
      await cleanupFlashcards(teacher.user.id);
      await cleanupFlashcardDecks(teacher.user.id);
      await cleanupFlashcards(studentInGroupA.id);
      await cleanupFlashcardDecks(studentInGroupA.id);
      await cleanupFlashcards(outsider.id);
      await cleanupFlashcardDecks(outsider.id);
      if (teacher.orgId) await cleanupOrganizationDeep(teacher.orgId);
    });

    it('get_due_flashcards (via /practice/new): only the group member sees the new card', async () => {
      mockUser(studentInGroupA);
      const reqA = createNextRequest(
        'http://localhost/api/v1/flashcards/practice/new?limit=50',
        undefined,
        { active_org_id: teacher.orgId! },
      );
      const resA = await getDueCards(reqA);
      const bodyA = await resA.json();
      expect(resA.status).toBe(200);
      expect(bodyA.data.some((c: { id: string }) => c.id === flashcardId)).toBe(true);

      mockUser(studentInGroupB);
      const reqB = createNextRequest(
        'http://localhost/api/v1/flashcards/practice/new?limit=50',
        undefined,
        { active_org_id: teacher.orgId! },
      );
      const resB = await getDueCards(reqB);
      const bodyB = await resB.json();
      expect(resB.status).toBe(200);
      expect(bodyB.data.some((c: { id: string }) => c.id === flashcardId)).toBe(false);
    });

    it('count_new_cards (via /practice/settings): only the group member is offered the card', async () => {
      mockUser(studentInGroupA);
      const reqA = createNextRequest(
        'http://localhost/api/v1/flashcards/practice/settings',
        undefined,
        {
          active_org_id: teacher.orgId!,
        },
      );
      const resA = await getSettings(reqA);
      const bodyA = await resA.json();
      expect(resA.status).toBe(200);
      expect(bodyA.data.totalNewCards).toBeGreaterThanOrEqual(1);

      mockUser(studentInGroupB);
      const reqB = createNextRequest(
        'http://localhost/api/v1/flashcards/practice/settings',
        undefined,
        {
          active_org_id: teacher.orgId!,
        },
      );
      const resB = await getSettings(reqB);
      const bodyB = await resB.json();
      expect(resB.status).toBe(200);
      expect(bodyB.data.totalNewCards).toBe(0);
    });

    it('get_practice_state_breakdown (via /practice/states): only the group member sees it counted', async () => {
      mockUser(studentInGroupA);
      const reqA = createNextRequest(
        'http://localhost/api/v1/flashcards/practice/states',
        undefined,
        {
          active_org_id: teacher.orgId!,
        },
      );
      const resA = await getStateBreakdown(reqA);
      const bodyA = await resA.json();
      expect(resA.status).toBe(200);
      expect(bodyA.data.totalCards).toBeGreaterThanOrEqual(1);

      mockUser(studentInGroupB);
      const reqB = createNextRequest(
        'http://localhost/api/v1/flashcards/practice/states',
        undefined,
        {
          active_org_id: teacher.orgId!,
        },
      );
      const resB = await getStateBreakdown(reqB);
      const bodyB = await resB.json();
      expect(resB.status).toBe(200);
      expect(bodyB.data.totalCards).toBe(0);
    });

    it('get_due_breakdown (via /practice/due/breakdown): a due review state does not leak past group scoping', async () => {
      const service = createServiceClient();
      const pastDue = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      for (const student of [studentInGroupA, studentInGroupB]) {
        const { error } = await service.from('flashcard_review_state').insert({
          user_id: student.id,
          flashcard_id: flashcardId,
          easiness_factor: 2.5,
          interval_days: 1,
          repetitions: 1,
          next_review_at: pastDue,
          last_reviewed_at: pastDue,
          last_quality: 4,
          learning_state: 'review',
          learning_step: 0,
          lapse_count: 0,
          is_leech: false,
        });
        if (error) throw new Error(`[setup] review state insert failed: ${error.message}`);
      }

      mockUser(studentInGroupA);
      const reqA = createNextRequest(
        'http://localhost/api/v1/flashcards/practice/due/breakdown',
        undefined,
        { active_org_id: teacher.orgId! },
      );
      const resA = await getDueBreakdown(reqA);
      const bodyA = await resA.json();
      expect(resA.status).toBe(200);
      expect(bodyA.data.total).toBeGreaterThanOrEqual(1);

      mockUser(studentInGroupB);
      const reqB = createNextRequest(
        'http://localhost/api/v1/flashcards/practice/due/breakdown',
        undefined,
        { active_org_id: teacher.orgId! },
      );
      const resB = await getDueBreakdown(reqB);
      const bodyB = await resB.json();
      expect(resB.status).toBe(200);
      expect(bodyB.data.total).toBe(0);
    });

    // #343: the stats "Treści" table used buildQueryFilter, which only signals
    // `_useRpc` for group scope — the query then filtered by organization only
    // and listed every card in the org (other groups' decks and other users'
    // private cards).
    it('cards-stats: student A sees only own + group-shared cards, never the outsider card', async () => {
      mockUser(studentInGroupA);
      const resA = await getCardsStats(
        createNextRequest(
          'http://localhost/api/v1/flashcards/practice/cards-stats?limit=100',
          undefined,
          { active_org_id: teacher.orgId! },
        ),
      );
      const bodyA = await resA.json();
      expect(resA.status).toBe(200);
      const idsA = bodyA.data.items.map((i: { id: string }) => i.id);
      expect(idsA).toContain(flashcardId);
      expect(idsA).toContain(ownFlashcardId);
      expect(idsA).not.toContain(outsiderFlashcardId);
      expect(bodyA.data.items).toHaveLength(2);
    });

    it('cards-stats: student B (other group, no own cards) sees nothing', async () => {
      mockUser(studentInGroupB);
      const resB = await getCardsStats(
        createNextRequest(
          'http://localhost/api/v1/flashcards/practice/cards-stats?limit=100',
          undefined,
          { active_org_id: teacher.orgId! },
        ),
      );
      const bodyB = await resB.json();
      expect(resB.status).toBe(200);
      expect(bodyB.data.items).toEqual([]);
    });

    it('states: the summary matches the cards-stats rows (own + shared)', async () => {
      mockUser(studentInGroupA);
      const statsRes = await getCardsStats(
        createNextRequest(
          'http://localhost/api/v1/flashcards/practice/cards-stats?limit=100',
          undefined,
          { active_org_id: teacher.orgId! },
        ),
      );
      const statsBody = await statsRes.json();
      const statesRes = await getStateBreakdown(
        createNextRequest('http://localhost/api/v1/flashcards/practice/states', undefined, {
          active_org_id: teacher.orgId!,
        }),
      );
      const statesBody = await statesRes.json();
      expect(statesRes.status).toBe(200);
      expect(statesBody.data.totalCards).toBe(statsBody.data.items.length);

      mockUser(studentInGroupB);
      const resB = await getStateBreakdown(
        createNextRequest('http://localhost/api/v1/flashcards/practice/states', undefined, {
          active_org_id: teacher.orgId!,
        }),
      );
      const bodyB = await resB.json();
      expect(resB.status).toBe(200);
      expect(bodyB.data.totalCards).toBe(0);
    });

    it('prepare: the group deck is only served to its group member', async () => {
      mockUser(studentInGroupA);
      const resA = await getPrepare(
        createNextRequest(
          `http://localhost/api/v1/flashcards/practice/prepare?deckIds=${deckId}`,
          undefined,
          { active_org_id: teacher.orgId! },
        ),
      );
      const bodyA = await resA.json();
      expect(resA.status).toBe(200);
      expect(bodyA.data.map((c: { id: string }) => c.id)).toEqual([flashcardId]);

      mockUser(studentInGroupB);
      const resB = await getPrepare(
        createNextRequest(
          `http://localhost/api/v1/flashcards/practice/prepare?deckIds=${deckId}`,
          undefined,
          { active_org_id: teacher.orgId! },
        ),
      );
      const bodyB = await resB.json();
      expect(resB.status).toBe(200);
      expect(bodyB.data).toEqual([]);
    });
  });
});
