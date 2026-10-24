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
import { GET as getDueBreakdown } from '@/app/(backend)/api/v1/flashcards/practice/due/breakdown/route';
import { GET as getDueCount } from '@/app/(backend)/api/v1/flashcards/practice/due/count/route';
import { GET as getDueCards } from '@/app/(backend)/api/v1/flashcards/practice/new/route';
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
      const deckId = deckBody.data.id as string;

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
    });

    afterAll(async () => {
      await cleanupFlashcardReviewState(studentInGroupA.id);
      await cleanupFlashcardReviewState(studentInGroupB.id);
      await cleanupFlashcards(teacher.user.id);
      await cleanupFlashcardDecks(teacher.user.id);
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

    // #345: `flashcard.read = group` means own cards + group-shared cards, so a
    // member's own personal deck must be offered/counted by all four study RPCs
    // while other members of the same org still never see it.
    it("offers and counts a member's own personal new cards (group scope)", async () => {
      const orgId = teacher.orgId!;
      mockUser(studentInGroupA);

      const deckRes = await createDeckPost(
        createNextRequest(
          'http://localhost/api/v1/flashcards/decks',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `own-cards-${copyId}`, visibility: 'personal' }),
          },
          { active_org_id: orgId },
        ),
      );
      const deckBody = await deckRes.json();
      if (!deckRes.ok || !deckBody.success) {
        throw new Error(`[setup] own deck creation failed: ${JSON.stringify(deckBody)}`);
      }
      const ownDeckId = deckBody.data.id as string;

      const ownCardIds: string[] = [];
      for (const n of [1, 2]) {
        const cardRes = await createFlashcardPost(
          createNextRequest(
            'http://localhost/api/v1/flashcards',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                front: `own-front-${copyId}-${n}`,
                back: `own-back-${copyId}-${n}`,
                deckId: ownDeckId,
              }),
            },
            { active_org_id: orgId },
          ),
        );
        const cardBody = await cardRes.json();
        if (!cardRes.ok || !cardBody.success) {
          throw new Error(`[setup] own card creation failed: ${JSON.stringify(cardBody)}`);
        }
        ownCardIds.push(cardBody.data.id as string);
      }

      try {
        // Whole study queue: the two own cards plus the group-shared card.
        const newRes = await getDueCards(
          createNextRequest('http://localhost/api/v1/flashcards/practice/new?limit=50', undefined, {
            active_org_id: orgId,
          }),
        );
        const newBody = await newRes.json();
        expect(newRes.status).toBe(200);
        const offeredIds = newBody.data.map((c: { id: string }) => c.id);
        for (const ownCardId of ownCardIds) expect(offeredIds).toContain(ownCardId);
        expect(offeredIds).toContain(flashcardId);

        // The issue's deck-filtered repro: the own deck yields exactly its cards.
        const ownDeckRes = await getDueCards(
          createNextRequest(
            `http://localhost/api/v1/flashcards/practice/new?limit=50&deckIds=${ownDeckId}`,
            undefined,
            { active_org_id: orgId },
          ),
        );
        const ownDeckBody = await ownDeckRes.json();
        expect(ownDeckRes.status).toBe(200);
        expect(ownDeckBody.data.map((c: { id: string }) => c.id).sort()).toEqual(
          [...ownCardIds].sort(),
        );

        // Learn badge / "N nowych kart": own new + group-shared new.
        const settingsRes = await getSettings(
          createNextRequest('http://localhost/api/v1/flashcards/practice/settings', undefined, {
            active_org_id: orgId,
          }),
        );
        const settingsBody = await settingsRes.json();
        expect(settingsRes.status).toBe(200);
        expect(settingsBody.data.totalNewCards).toBeGreaterThanOrEqual(3);

        // Stats overview counts them as well.
        const statesRes = await getStateBreakdown(
          createNextRequest('http://localhost/api/v1/flashcards/practice/states', undefined, {
            active_org_id: orgId,
          }),
        );
        const statesBody = await statesRes.json();
        expect(statesRes.status).toBe(200);
        expect(statesBody.data.totalCards).toBeGreaterThanOrEqual(3);
        expect(statesBody.data.neverPracticed).toBeGreaterThanOrEqual(3);

        // Own due reviews are visible too (get_due_breakdown feeds the badge).
        const service = createServiceClient();
        const pastDue = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { error: reviewStateError } = await service.from('flashcard_review_state').insert({
          user_id: studentInGroupA.id,
          flashcard_id: ownCardIds[0],
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
        if (reviewStateError) {
          throw new Error(`[setup] own review state insert failed: ${reviewStateError.message}`);
        }

        const dueCountRes = await getDueCount(
          createNextRequest('http://localhost/api/v1/flashcards/practice/due/count', undefined, {
            active_org_id: orgId,
          }),
        );
        const dueCountBody = await dueCountRes.json();
        expect(dueCountRes.status).toBe(200);
        expect(dueCountBody.data.count).toBeGreaterThanOrEqual(1);

        // Isolation: another member of the same org never sees these own cards.
        mockUser(studentInGroupB);
        const otherRes = await getDueCards(
          createNextRequest(
            `http://localhost/api/v1/flashcards/practice/new?limit=50&deckIds=${ownDeckId}`,
            undefined,
            { active_org_id: orgId },
          ),
        );
        const otherBody = await otherRes.json();
        expect(otherRes.status).toBe(200);
        expect(otherBody.data).toEqual([]);

        const otherSettingsRes = await getSettings(
          createNextRequest('http://localhost/api/v1/flashcards/practice/settings', undefined, {
            active_org_id: orgId,
          }),
        );
        const otherSettingsBody = await otherSettingsRes.json();
        expect(otherSettingsRes.status).toBe(200);
        expect(otherSettingsBody.data.totalNewCards).toBe(0);
      } finally {
        await cleanupFlashcardReviewState(studentInGroupA.id);
        await cleanupFlashcards(studentInGroupA.id);
        await cleanupFlashcardDecks(studentInGroupA.id);
      }
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
  });
});
