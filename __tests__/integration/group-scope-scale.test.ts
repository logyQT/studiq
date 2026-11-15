import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json } from '#test/helpers/json';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import { cleanupOrganizationDeep, createServiceClient, mockUser } from '#test/integration/helpers';
import { createNextRequest, requiredAt } from '#test/integration/test-utils';
import { GET as listFlashcards } from '@/app/(backend)/api/v1/flashcards/route';
import { GET as listQuestions } from '@/app/(backend)/api/v1/questions/route';

const suiteId = crypto.randomUUID().slice(0, 8);

/**
 * #1049: the group scope used to be built from the id of every question (or card) the group
 * can see, and those ids went into the request URL (`id.in.(…)`). PostgREST refuses a URL
 * beyond ~15 KB, which is ~390 ids, so a student in a group could not open a shared bank (or
 * deck) of that size at all: the list answered 500. The filter now names the group's banks and
 * decks, so its size no longer grows with the number of rows inside them.
 *
 * 450 rows each is past the old ceiling with room to spare and still quick to insert.
 */
const ROWS = 450;

describe('group scope on shared banks and decks of 450 rows (#1049)', () => {
  let teacher!: BeforeResult;
  let studentInGroup!: TestUserFixture;
  let studentOutside!: TestUserFixture;
  let orgId!: string;
  let bankId!: string;
  let deckId!: string;

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: `group-scale-org-${suiteId}`, groups: 2 });
    if (!teacher.orgId) throw new Error('[setup] org not created');
    orgId = teacher.orgId;
    const groupA = requiredAt(teacher.groups, 1, 'seeded group');
    const groupB = requiredAt(teacher.groups, 2, 'seeded group');

    const service = createServiceClient();
    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    if (!memberRole) throw new Error('[setup] member org role not found');

    studentInGroup = await createTestUser({ role: 'student' });
    studentOutside = await createTestUser({ role: 'student' });
    for (const [student, group] of [
      [studentInGroup, groupA],
      [studentOutside, groupB],
    ] as const) {
      const { error } = await service
        .from('org_members')
        .insert({ organization_id: orgId, user_id: student.id, org_role_id: memberRole.id });
      if (error) throw new Error(`[setup] org membership failed: ${error.message}`);
      const { error: groupError } = await service
        .from('group_members')
        .insert({ group_id: group, user_id: student.id, role: 'member' });
      if (groupError) throw new Error(`[setup] group membership failed: ${groupError.message}`);
    }

    // A bank shared with group A, holding ROWS questions.
    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        name: `group-scale-bank-${suiteId}`,
        organization_id: orgId,
        created_by: teacher.user.id,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(`[setup] bank failed: ${bankError.message}`);
    bankId = bank.id;
    const { error: shareBankError } = await service
      .from('bank_groups')
      .insert({ bank_id: bankId, group_id: groupA });
    if (shareBankError) throw new Error(`[setup] bank share failed: ${shareBankError.message}`);

    // A deck shared with group A, holding ROWS cards.
    const { data: deck, error: deckError } = await service
      .from('flashcard_decks')
      .insert({
        name: `group-scale-deck-${suiteId}`,
        organization_id: orgId,
        created_by: teacher.user.id,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (deckError) throw new Error(`[setup] deck failed: ${deckError.message}`);
    deckId = deck.id;
    const { error: shareDeckError } = await service
      .from('deck_groups')
      .insert({ deck_id: deckId, group_id: groupA });
    if (shareDeckError) throw new Error(`[setup] deck share failed: ${shareDeckError.message}`);

    for (let from = 0; from < ROWS; from += 150) {
      const batch = Array.from({ length: Math.min(150, ROWS - from) }, (_, i) => from + i);
      const { error: questionsError } = await service.from('questions').insert(
        batch.map((n) => ({
          bank_id: bankId,
          organization_id: orgId,
          created_by: teacher.user.id,
          type: 'open' as const,
          content: `group-scale-question-${suiteId}-${n}`,
          visibility: 'group' as const,
        })),
      );
      if (questionsError) throw new Error(`[setup] questions failed: ${questionsError.message}`);
      const { error: cardsError } = await service.from('flashcards').insert(
        batch.map((n) => ({
          deck_id: deckId,
          organization_id: orgId,
          created_by: teacher.user.id,
          front: `group-scale-front-${suiteId}-${n}`,
          back: `group-scale-back-${suiteId}-${n}`,
          visibility: 'group' as const,
        })),
      );
      if (cardsError) throw new Error(`[setup] cards failed: ${cardsError.message}`);
    }
  });

  afterAll(async () => {
    const service = createServiceClient();
    if (bankId) await service.from('question_banks').delete().eq('id', bankId);
    if (deckId) {
      await service.from('flashcards').delete().eq('deck_id', deckId);
      await service.from('flashcard_decks').delete().eq('id', deckId);
    }
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  const get = (url: string) => createNextRequest(url, {}, { active_org_id: orgId });

  it('pages the 450 questions of a shared bank for a member of the group', async () => {
    mockUser(studentInGroup);
    const response = await listQuestions(
      get(`http://localhost/api/v1/questions?bankId=${bankId}&page=1&limit=25`),
    );
    const body = await json<{
      data: { items: unknown[]; total: number; page: number; limit: number };
    }>(response);

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(ROWS);
    expect(body.data.items).toHaveLength(25);
  });

  it('still answers the unpaged question list of that bank', async () => {
    mockUser(studentInGroup);
    const response = await listQuestions(get(`http://localhost/api/v1/questions?bankId=${bankId}`));
    const body = await json<{ data: unknown[] }>(response);

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(ROWS);
  });

  it('shows the bank to nobody outside the group, without an error', async () => {
    mockUser(studentOutside);
    const response = await listQuestions(
      get(`http://localhost/api/v1/questions?bankId=${bankId}&page=1&limit=25`),
    );
    const body = await json<{ data: { items: unknown[]; total: number } }>(response);

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(0);
    expect(body.data.items).toHaveLength(0);
  });

  it('lists the cards of a shared deck of 450 for a member of the group', async () => {
    mockUser(studentInGroup);
    const response = await listFlashcards(
      get(`http://localhost/api/v1/flashcards?deckIds=${deckId}&limit=50`),
    );
    const body = await json<{ data: { items: unknown[]; hasMore: boolean } }>(response);

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(50);
    expect(body.data.hasMore).toBe(true);
  });

  it('shows the deck to nobody outside the group, without an error', async () => {
    mockUser(studentOutside);
    const response = await listFlashcards(
      get(`http://localhost/api/v1/flashcards?deckIds=${deckId}&limit=50`),
    );
    const body = await json<{ data: { items: unknown[] } }>(response);

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(0);
  });
});
