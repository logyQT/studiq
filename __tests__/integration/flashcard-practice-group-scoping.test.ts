import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json } from '#test/helpers/json';
import { createSeedDb } from '#test/helpers/tenant-seed';
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
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { POST as createDeckPost } from '@/app/(backend)/api/v1/flashcards/decks/route';
import { GET as getCardsStats } from '@/app/(backend)/api/v1/flashcards/practice/cards-stats/route';
import { GET as getDueBreakdown } from '@/app/(backend)/api/v1/flashcards/practice/due/breakdown/route';
import { GET as getDueCount } from '@/app/(backend)/api/v1/flashcards/practice/due/count/route';
import { GET as getDueCards } from '@/app/(backend)/api/v1/flashcards/practice/new/route';
import { GET as getPrepare } from '@/app/(backend)/api/v1/flashcards/practice/prepare/route';
import { GET as getSettings } from '@/app/(backend)/api/v1/flashcards/practice/settings/route';
import { GET as getStateBreakdown } from '@/app/(backend)/api/v1/flashcards/practice/states/route';
import { POST as createFlashcardPost } from '@/app/(backend)/api/v1/flashcards/route';

const suiteId = crypto.randomUUID().slice(0, 8);

/** Payload of a created deck/card (`{ success, data }`) — only `data.id` is read. */
interface CreatedBody {
  success: boolean;
  data: { id: string };
}

/** `/practice/new` and `/practice/prepare` payloads: the card list itself. */
interface CardListBody {
  data: Array<{ id: string }>;
}

/** `/practice/settings` payload — the field read below. */
interface SettingsBody {
  data: { totalNewCards: number };
}

/** `/practice/states` payload — the fields read below. */
interface StatesBody {
  data: { totalCards: number; neverPracticed: number };
}

/** `/practice/due/count` payload — the field read below. */
interface DueCountBody {
  data: { count: number };
}

/** `/practice/due/breakdown` payload — the field read below. */
interface DueBreakdownBody {
  data: { total: number };
}

/** `/practice/cards-stats` payload — the fields read below. */
interface CardsStatsBody {
  data: { items: Array<{ id: string }> };
}

/**
 * Regression coverage for the 20260915000008 migration: get_due_flashcards,
 * get_due_breakdown, get_practice_state_breakdown and count_new_cards all
 * treated a group-shared deck as visible to the whole org instead of just
 * the group it was shared with. These tests exercise all four RPCs (three
 * through their real HTTP routes, plus a direct review-state injection to
 * reach the due-breakdown path) with a card shared to one group only, and
 * assert an org member of a *different* group sees none of it.
 */
describe(`Flashcard Practice Group Scoping`, () => {
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
    // can't race-delete this org out from under another concurrently running suite.
    teacher = await before({
      role: 'educator',
      org: `group-scope-org-${suiteId}`,
      groups: 2,
    });
    const orgId = teacher.orgId;
    if (!orgId) throw new Error('[setup] org not created');
    groupA = teacher.groups[1];
    const groupB = teacher.groups[2];

    const service = createSeedDb();
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
          name: `group-scope-deck-${suiteId}`,
          visibility: 'group',
          groupIds: [groupA],
        }),
      },
      { active_org_id: orgId },
    );
    const deckRes = await createDeckPost(deckReq);
    const deckBody = await json<CreatedBody>(deckRes);
    if (!deckRes.ok || !deckBody.success) {
      throw new Error(`[setup] deck creation failed: ${JSON.stringify(deckBody)}`);
    }
    deckId = deckBody.data.id;

    const flashcardReq = createNextRequest(
      'http://localhost/api/v1/flashcards',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          front: `group-scope-front-${suiteId}`,
          back: `group-scope-back-${suiteId}`,
          deckId,
        }),
      },
      { active_org_id: orgId },
    );
    const flashcardRes = await createFlashcardPost(flashcardReq);
    const flashcardBody = await json<CreatedBody>(flashcardRes);
    if (!flashcardRes.ok || !flashcardBody.success) {
      throw new Error(`[setup] flashcard creation failed: ${JSON.stringify(flashcardBody)}`);
    }
    flashcardId = flashcardBody.data.id;

    // #343: a personal deck + card owned by student A. Own-scope content must
    // stay visible to its owner (and only to them).
    mockUser(studentInGroupA);
    const ownDeckRes = await createDeckPost(
      createNextRequest(
        'http://localhost/api/v1/flashcards/decks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `own-deck-${suiteId}`, visibility: 'personal' }),
        },
        { active_org_id: orgId },
      ),
    );
    const ownDeckBody = await json<CreatedBody>(ownDeckRes);
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
            front: `own-front-${suiteId}`,
            back: `own-back-${suiteId}`,
            deckId: ownDeckBody.data.id,
          }),
        },
        { active_org_id: orgId },
      ),
    );
    const ownFlashcardBody = await json<CreatedBody>(ownFlashcardRes);
    if (!ownFlashcardRes.ok || !ownFlashcardBody.success) {
      throw new Error(`[setup] own flashcard creation failed: ${JSON.stringify(ownFlashcardBody)}`);
    }
    ownFlashcardId = ownFlashcardBody.data.id;

    // #343: the S3 shape — a user with NO membership in the org owns a card
    // stamped with the org id. RLS is org-level, so only the app-layer
    // accessible filter can keep it out of other students' views.
    outsider = await createTestUser({ role: 'student' });
    const { data: outsiderDeck, error: outsiderDeckError } = await service
      .from('flashcard_decks')
      .insert({
        name: `outsider-deck-${suiteId}`,
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
        front: `outsider-front-${suiteId}`,
        back: `outsider-back-${suiteId}`,
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
    outsiderFlashcardId = outsiderCard.id;
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
    const bodyA = await json<CardListBody>(resA);
    expect(resA.status).toBe(200);
    expect(bodyA.data.some((c) => c.id === flashcardId)).toBe(true);

    mockUser(studentInGroupB);
    const reqB = createNextRequest(
      'http://localhost/api/v1/flashcards/practice/new?limit=50',
      undefined,
      { active_org_id: teacher.orgId! },
    );
    const resB = await getDueCards(reqB);
    const bodyB = await json<CardListBody>(resB);
    expect(resB.status).toBe(200);
    expect(bodyB.data.some((c) => c.id === flashcardId)).toBe(false);
  });

  // #345: `flashcard.read = group` means own cards + group-shared cards, so a
  // member's own personal deck must be offered/counted by all four study RPCs
  // while other members of the same org still never see it.
  it("offers and counts a member's own personal new cards (group scope)", async () => {
    const orgId = teacher.orgId!;
    mockUser(studentInGroupA);

    // Distinct prefixes (not the `own-*` ones used by the #343 fixtures) so
    // the prefix-scoped cleanup below never deletes another test's cards.
    const deckName = `345-own-deck-${suiteId}`;
    const frontPrefix = `345-own-front-${suiteId}-`;

    const deckRes = await createDeckPost(
      createNextRequest(
        'http://localhost/api/v1/flashcards/decks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: deckName, visibility: 'personal' }),
        },
        { active_org_id: orgId },
      ),
    );
    const deckBody = await json<CreatedBody>(deckRes);
    if (!deckRes.ok || !deckBody.success) {
      throw new Error(`[setup] own deck creation failed: ${JSON.stringify(deckBody)}`);
    }
    const ownDeckId = deckBody.data.id;

    const ownCardIds: string[] = [];
    for (const n of [1, 2]) {
      const cardRes = await createFlashcardPost(
        createNextRequest(
          'http://localhost/api/v1/flashcards',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              front: `${frontPrefix}${n}`,
              back: `345-own-back-${suiteId}-${n}`,
              deckId: ownDeckId,
            }),
          },
          { active_org_id: orgId },
        ),
      );
      const cardBody = await json<CreatedBody>(cardRes);
      if (!cardRes.ok || !cardBody.success) {
        throw new Error(`[setup] own card creation failed: ${JSON.stringify(cardBody)}`);
      }
      ownCardIds.push(cardBody.data.id);
    }

    try {
      // Whole study queue: the two own cards plus the group-shared card.
      const newRes = await getDueCards(
        createNextRequest('http://localhost/api/v1/flashcards/practice/new?limit=50', undefined, {
          active_org_id: orgId,
        }),
      );
      const newBody = await json<CardListBody>(newRes);
      expect(newRes.status).toBe(200);
      const offeredIds = newBody.data.map((c) => c.id);
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
      const ownDeckBody = await json<CardListBody>(ownDeckRes);
      expect(ownDeckRes.status).toBe(200);
      expect(ownDeckBody.data.map((c) => c.id).toSorted()).toEqual([...ownCardIds].toSorted());

      // Learn badge / "N nowych kart": own new + group-shared new.
      const settingsRes = await getSettings(
        createNextRequest('http://localhost/api/v1/flashcards/practice/settings', undefined, {
          active_org_id: orgId,
        }),
      );
      const settingsBody = await json<SettingsBody>(settingsRes);
      expect(settingsRes.status).toBe(200);
      expect(settingsBody.data.totalNewCards).toBeGreaterThanOrEqual(3);

      // Stats overview counts them as well.
      const statesRes = await getStateBreakdown(
        createNextRequest('http://localhost/api/v1/flashcards/practice/states', undefined, {
          active_org_id: orgId,
        }),
      );
      const statesBody = await json<StatesBody>(statesRes);
      expect(statesRes.status).toBe(200);
      expect(statesBody.data.totalCards).toBeGreaterThanOrEqual(3);
      expect(statesBody.data.neverPracticed).toBeGreaterThanOrEqual(3);

      // Own due reviews are visible too (get_due_breakdown feeds the badge).
      const service = createSeedDb();
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
        sm2_lapse_count: 0,
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
      const dueCountBody = await json<DueCountBody>(dueCountRes);
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
      const otherBody = await json<CardListBody>(otherRes);
      expect(otherRes.status).toBe(200);
      expect(otherBody.data).toEqual([]);

      const otherSettingsRes = await getSettings(
        createNextRequest('http://localhost/api/v1/flashcards/practice/settings', undefined, {
          active_org_id: orgId,
        }),
      );
      const otherSettingsBody = await json<SettingsBody>(otherSettingsRes);
      expect(otherSettingsRes.status).toBe(200);
      expect(otherSettingsBody.data.totalNewCards).toBe(0);
    } finally {
      await cleanupFlashcardReviewState(studentInGroupA.id);
      await cleanupFlashcards(studentInGroupA.id, frontPrefix);
      await cleanupFlashcardDecks(studentInGroupA.id, deckName);
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
    const bodyA = await json<SettingsBody>(resA);
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
    const bodyB = await json<SettingsBody>(resB);
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
    const bodyA = await json<StatesBody>(resA);
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
    const bodyB = await json<StatesBody>(resB);
    expect(resB.status).toBe(200);
    expect(bodyB.data.totalCards).toBe(0);
  });

  it('get_due_breakdown (via /practice/due/breakdown): a due review state does not leak past group scoping', async () => {
    const service = createSeedDb();
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
        sm2_lapse_count: 0,
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
    const bodyA = await json<DueBreakdownBody>(resA);
    expect(resA.status).toBe(200);
    expect(bodyA.data.total).toBeGreaterThanOrEqual(1);

    mockUser(studentInGroupB);
    const reqB = createNextRequest(
      'http://localhost/api/v1/flashcards/practice/due/breakdown',
      undefined,
      { active_org_id: teacher.orgId! },
    );
    const resB = await getDueBreakdown(reqB);
    const bodyB = await json<DueBreakdownBody>(resB);
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
    const bodyA = await json<CardsStatsBody>(resA);
    expect(resA.status).toBe(200);
    const idsA = bodyA.data.items.map((i) => i.id);
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
    const bodyB = await json<CardsStatsBody>(resB);
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
    const statsBody = await json<CardsStatsBody>(statsRes);
    const statesRes = await getStateBreakdown(
      createNextRequest('http://localhost/api/v1/flashcards/practice/states', undefined, {
        active_org_id: teacher.orgId!,
      }),
    );
    const statesBody = await json<StatesBody>(statesRes);
    expect(statesRes.status).toBe(200);
    expect(statesBody.data.totalCards).toBe(statsBody.data.items.length);

    mockUser(studentInGroupB);
    const resB = await getStateBreakdown(
      createNextRequest('http://localhost/api/v1/flashcards/practice/states', undefined, {
        active_org_id: teacher.orgId!,
      }),
    );
    const bodyB = await json<StatesBody>(resB);
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
    const bodyA = await json<CardListBody>(resA);
    expect(resA.status).toBe(200);
    expect(bodyA.data.map((c) => c.id)).toEqual([flashcardId]);

    mockUser(studentInGroupB);
    const resB = await getPrepare(
      createNextRequest(
        `http://localhost/api/v1/flashcards/practice/prepare?deckIds=${deckId}`,
        undefined,
        { active_org_id: teacher.orgId! },
      ),
    );
    const bodyB = await json<CardListBody>(resB);
    expect(resB.status).toBe(200);
    expect(bodyB.data).toEqual([]);
  });
});
