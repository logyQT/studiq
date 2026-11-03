import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useRealSupabase,
  cleanupOrganizationByName,
  cleanupQuestions,
  createServiceClient,
  seedGroupMembership,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';
import { asJson } from '#test/helpers/json';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';

const suiteId = crypto.randomUUID().slice(0, 8);

/** The row shape `get_accessible_questions` returns (only the fields these tests read). */
interface AccessibleQuestion {
  id: string;
  question_options: { content: string; is_correct: boolean }[];
}

interface AccessibleQuestionsParams {
  p_user_id: string;
  p_org_id: string | null;
  p_scope: 'own' | 'group' | 'organization' | 'any';
  p_question_id?: string;
  p_bank_ids?: string[];
  p_type?: 'mcq' | 'true_false' | 'open';
}

/** What `seedOrganization` hands back. */
interface SeededOrganization {
  org: { id: string };
  memberRoleId: string;
  teacherRoleId: string;
  defaultGroupId: string;
}

/** `createServiceClient()` is untyped, so the RPC payload is the one `any` boundary here. */
async function getAccessibleQuestions(
  params: AccessibleQuestionsParams,
): Promise<AccessibleQuestion[]> {
  const response = await createServiceClient().rpc('get_accessible_questions', params);
  return asJson<AccessibleQuestion[]>(response.data ?? []);
}

/** The `id` an RPC row carries, if it has one. */
function readId(row: object): unknown {
  return (row as { id?: unknown }).id;
}

/** Ids of the rows an RPC returned, in a stable order. */
function sortedIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return (rows as unknown[])
    .map((row) => (typeof row === 'object' && row !== null ? readId(row) : undefined))
    .filter((id): id is string => typeof id === 'string')
    .toSorted();
}

/** How many rows an RPC returned. */
function rowCount(rows: unknown): number {
  return Array.isArray(rows) ? rows.length : 0;
}

describe(`get_accessible_questions RPC`, () => {
  const ORG_PREFIX = `rpc-q-test-${suiteId}-`;

  let orgId: string;
  let defaultGroupId: string;
  let bank1Id: string;
  let bank2Id: string;
  let q1Id: string;
  let q2Id: string;
  let q3Id: string;
  let q4Id: string;

  let teacher: TestUserFixture;
  let studentA: TestUserFixture;
  let studentB: TestUserFixture;

  beforeAll(async () => {
    teacher = await createTestUser({ role: 'educator' });
    studentA = await createTestUser({ role: 'student' });
    studentB = await createTestUser({ role: 'student' });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    useRealSupabase();

    // Clean up ALL questions from previous test runs (including other suites).
    // p_org_id=null returns questions across ALL orgs, so we must clean globally.
    for (const user of [teacher, studentA, studentB]) {
      await cleanupQuestions(user.id);
    }

    const seeded = asJson<SeededOrganization>(await seedOrganization(`${ORG_PREFIX}${Date.now()}`));
    orgId = seeded.org.id;
    defaultGroupId = seeded.defaultGroupId;

    // Add users to org
    await seedOrgMembership({
      organizationId: orgId,
      userId: studentA.id,
      orgRoleId: seeded.memberRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: studentB.id,
      orgRoleId: seeded.memberRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: teacher.id,
      orgRoleId: seeded.teacherRoleId,
    });

    // Student A → group member, Teacher → group member, Student B → NOT member
    await seedGroupMembership({
      groupId: defaultGroupId,
      userId: studentA.id,
      role: 'member',
    });
    await seedGroupMembership({
      groupId: defaultGroupId,
      userId: teacher.id,
      role: 'member',
    });

    const sb = createServiceClient();

    // Create 2 banks
    const b1Response = await sb
      .from('question_banks')
      .insert({
        name: 'Bank 1',
        organization_id: orgId,
        created_by: teacher.id,
      })
      .select()
      .single();
    bank1Id = asJson<{ id: string }>(b1Response.data).id;

    const b2Response = await sb
      .from('question_banks')
      .insert({
        name: 'Bank 2',
        organization_id: orgId,
        created_by: teacher.id,
      })
      .select()
      .single();
    bank2Id = asJson<{ id: string }>(b2Response.data).id;

    // Bank1 → Group, Bank2 → no group
    await sb.from('bank_groups').insert({ bank_id: bank1Id, group_id: defaultGroupId });

    // Create 4 questions (bank_id is a direct NOT NULL FK since 20260716000001).
    // Content is prefixed with suiteId so cleanupQuestions can scope by copy.
    const q1Response = await sb
      .from('questions')
      .insert({
        type: 'mcq',
        content: `${suiteId}:Q1: StudentA, Bank1`,
        created_by: studentA.id,
        organization_id: orgId,
        visibility: 'personal',
        bank_id: bank1Id,
      })
      .select()
      .single();
    q1Id = asJson<{ id: string }>(q1Response.data).id;

    const q2Response = await sb
      .from('questions')
      .insert({
        type: 'mcq',
        content: `${suiteId}:Q2: StudentA, Bank2`,
        created_by: studentA.id,
        organization_id: orgId,
        visibility: 'personal',
        bank_id: bank2Id,
      })
      .select()
      .single();
    q2Id = asJson<{ id: string }>(q2Response.data).id;

    const q3Response = await sb
      .from('questions')
      .insert({
        type: 'mcq',
        content: `${suiteId}:Q3: StudentB, Bank1`,
        created_by: studentB.id,
        organization_id: orgId,
        visibility: 'personal',
        bank_id: bank1Id,
      })
      .select()
      .single();
    q3Id = asJson<{ id: string }>(q3Response.data).id;

    const q4Response = await sb
      .from('questions')
      .insert({
        type: 'mcq',
        content: `${suiteId}:Q4: StudentB, no group`,
        created_by: studentB.id,
        organization_id: orgId,
        visibility: 'personal',
        bank_id: bank2Id,
      })
      .select()
      .single();
    q4Id = asJson<{ id: string }>(q4Response.data).id;

    // Answers for Q1 (for p_question_id test)
    await sb.from('question_options').insert([
      { question_id: q1Id, content: 'Ans 1', is_correct: true, order_index: 0 },
      { question_id: q1Id, content: 'Ans 2', is_correct: false, order_index: 1 },
    ]);
  });

  afterAll(async () => {
    // Clean up ALL questions for test users (org cleanup won't touch them)
    for (const user of [teacher, studentA, studentB]) {
      await cleanupQuestions(user.id);
    }
    await cleanupOrganizationByName(ORG_PREFIX);
  });

  // ---------------------------------------------------------------
  // Scope tests — Student A (group member)
  // ---------------------------------------------------------------
  describe('scope — Student A (group member)', () => {
    it("p_scope='own' returns only own questions", async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentA.id,
        p_org_id: orgId,
        p_scope: 'own',
      });

      const ids = sortedIds(data);
      expect(ids).toEqual([q1Id, q2Id].toSorted());
    });

    it("p_scope='group' returns own + group-shared", async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentA.id,
        p_org_id: orgId,
        p_scope: 'group',
      });

      const ids = sortedIds(data);
      expect(ids).toEqual([q1Id, q2Id, q3Id].toSorted());
    });

    it("p_scope='organization' returns all questions in org", async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentA.id,
        p_org_id: orgId,
        p_scope: 'organization',
      });

      const ids = sortedIds(data);
      expect(ids).toEqual([q1Id, q2Id, q3Id, q4Id].toSorted());
    });

    it("p_scope='any' returns all questions in org", async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentA.id,
        p_org_id: orgId,
        p_scope: 'any',
      });

      const ids = sortedIds(data);
      expect(ids).toEqual([q1Id, q2Id, q3Id, q4Id].toSorted());
    });
  });

  // ---------------------------------------------------------------
  // Scope tests — Student B (NOT a group member)
  // ---------------------------------------------------------------
  describe('scope — Student B (not a group member)', () => {
    it("p_scope='own' returns only own questions", async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentB.id,
        p_org_id: orgId,
        p_scope: 'own',
      });

      const ids = sortedIds(data);
      expect(ids).toEqual([q3Id, q4Id].toSorted());
    });

    it("p_scope='group' returns only own (no group access)", async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentB.id,
        p_org_id: orgId,
        p_scope: 'group',
      });

      // Student B has no group membership, so only own questions are returned
      const ids = sortedIds(data);
      expect(ids).toEqual([q3Id, q4Id].toSorted());
    });

    it("p_scope='organization' returns all questions", async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentB.id,
        p_org_id: orgId,
        p_scope: 'organization',
      });

      expect(rowCount(data)).toBe(4);
    });
  });

  // ---------------------------------------------------------------
  // p_question_id — single lookup with answers
  // ---------------------------------------------------------------
  describe('p_question_id', () => {
    it('returns question with answers inline when accessible', async () => {
      const response = await createServiceClient().rpc('get_accessible_questions', {
        p_user_id: studentA.id,
        p_org_id: orgId,
        p_scope: 'own',
        p_question_id: q1Id,
      });

      expect(response.error).toBeNull();
      const data = asJson<AccessibleQuestion[]>(response.data ?? []);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(q1Id);
      expect(data[0].question_options).toBeDefined();
      expect(Array.isArray(data[0].question_options)).toBe(true);
      expect(data[0].question_options).toHaveLength(2);
      expect(data[0].question_options[0].content).toBe('Ans 1');
      expect(data[0].question_options[0].is_correct).toBe(true);
    });

    it('returns empty when question is not accessible', async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentB.id,
        p_org_id: orgId,
        p_scope: 'group',
        p_question_id: q1Id, // Q1 belongs to Student A, not shared via group
      });

      expect(data).toHaveLength(0);
    });

    it('returns empty for nonexistent id', async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentA.id,
        p_org_id: orgId,
        p_scope: 'any',
        p_question_id: '00000000-0000-0000-0000-000000000000',
      });

      expect(data).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // Filter params
  // ---------------------------------------------------------------
  describe('filter params', () => {
    it('p_bank_ids filters by bank', async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentA.id,
        p_org_id: orgId,
        p_scope: 'organization',
        p_bank_ids: [bank1Id],
      });

      const ids = sortedIds(data);
      expect(ids).toEqual([q1Id, q3Id].toSorted()); // Q1 and Q3 are in Bank1
    });

    it('p_type filters by type', async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentA.id,
        p_org_id: orgId,
        p_scope: 'any',
        p_type: 'mcq',
      });

      expect(rowCount(data)).toBe(4); // All questions are mcq
    });

    it('p_type returns empty for non-matching type', async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentA.id,
        p_org_id: orgId,
        p_scope: 'any',
        p_type: 'true_false',
      });

      expect(data).toHaveLength(0);
    });

    it('p_bank_ids returns empty for non-matching bank', async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentA.id,
        p_org_id: orgId,
        p_scope: 'organization',
        p_bank_ids: ['00000000-0000-0000-0000-000000000000'],
      });

      expect(data).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // p_org_id = null (no active org)
  // ---------------------------------------------------------------
  describe('p_org_id = null', () => {
    it('returns own questions across all orgs when p_org_id is null', async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentA.id,
        p_org_id: null,
        p_scope: 'own',
      });

      // No org filter — returns Student A's own questions from any org
      const ids = sortedIds(data);
      expect(ids).toEqual([q1Id, q2Id].toSorted());
    });
  });

  // ---------------------------------------------------------------
  // Default scope is 'own'
  // ---------------------------------------------------------------
  describe('default scope', () => {
    it("p_scope='own' returns own questions only (default scope)", async () => {
      const data = await getAccessibleQuestions({
        p_user_id: studentA.id,
        p_org_id: orgId,
        p_scope: 'own',
      });

      const ids = sortedIds(data);
      expect(ids).toEqual([q1Id, q2Id].toSorted());
    });
  });
});
