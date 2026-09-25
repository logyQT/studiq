import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  applyRegisteredMock,
  cleanupOrganizationByName,
  cleanupQuestions,
  createServiceClient,
  seedGroupMembership,
  seedOrganization,
  seedOrgMembership,
  TEST_USERS,
} from '#test/integration/helpers';

forEachCopy((copyId) => {
  describe(`get_accessible_questions RPC [${copyId}]`, () => {
    registerMock(copyId, null);

    const ORG_PREFIX = `rpc-q-test-${copyId}-`;

    let orgId: string;
    let defaultGroupId: string;
    let bank1Id: string;
    let bank2Id: string;
    let q1Id: string;
    let q2Id: string;
    let q3Id: string;
    let q4Id: string;

    beforeEach(async () => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);

      // Clean up ALL questions from previous test runs (including other copies).
      // Safe because sequence.concurrent: false — copies run sequentially.
      // p_org_id=null returns questions across ALL orgs, so we must clean globally.
      for (const user of Object.values(TEST_USERS)) {
        await cleanupQuestions(user.id);
      }

      const seeded = await seedOrganization(`${ORG_PREFIX}${Date.now()}`);
      orgId = seeded.org.id;
      defaultGroupId = seeded.defaultGroupId;

      // Add users to org
      await seedOrgMembership({
        organizationId: orgId,
        userId: TEST_USERS.STUDENT.id,
        orgRoleId: seeded.memberRoleId,
      });
      await seedOrgMembership({
        organizationId: orgId,
        userId: TEST_USERS.STUDENT2.id,
        orgRoleId: seeded.memberRoleId,
      });
      await seedOrgMembership({
        organizationId: orgId,
        userId: TEST_USERS.TEACHER.id,
        orgRoleId: seeded.teacherRoleId,
      });

      // Student A → group member, Teacher → group member, Student B → NOT member
      await seedGroupMembership({
        groupId: defaultGroupId,
        userId: TEST_USERS.STUDENT.id,
        role: 'member',
      });
      await seedGroupMembership({
        groupId: defaultGroupId,
        userId: TEST_USERS.TEACHER.id,
        role: 'member',
      });

      const sb = createServiceClient();

      // Create 2 banks
      const { data: b1 } = await sb
        .from('question_banks')
        .insert({
          name: 'Bank 1',
          organization_id: orgId,
          created_by: TEST_USERS.TEACHER.id,
        })
        .select()
        .single();
      bank1Id = b1!.id;

      const { data: b2 } = await sb
        .from('question_banks')
        .insert({
          name: 'Bank 2',
          organization_id: orgId,
          created_by: TEST_USERS.TEACHER.id,
        })
        .select()
        .single();
      bank2Id = b2!.id;

      // Bank1 → Group, Bank2 → no group
      await sb.from('bank_groups').insert({ bank_id: bank1Id, group_id: defaultGroupId });

      // Create 4 questions (bank_id is a direct NOT NULL FK since 20260716000001).
      // Content is prefixed with copyId so cleanupQuestions can scope by copy.
      const { data: q1 } = await sb
        .from('questions')
        .insert({
          type: 'mcq',
          content: `${copyId}:Q1: StudentA, Bank1`,
          created_by: TEST_USERS.STUDENT.id,
          organization_id: orgId,
          visibility: 'personal',
          bank_id: bank1Id,
        })
        .select()
        .single();
      q1Id = q1!.id;

      const { data: q2 } = await sb
        .from('questions')
        .insert({
          type: 'mcq',
          content: `${copyId}:Q2: StudentA, Bank2`,
          created_by: TEST_USERS.STUDENT.id,
          organization_id: orgId,
          visibility: 'personal',
          bank_id: bank2Id,
        })
        .select()
        .single();
      q2Id = q2!.id;

      const { data: q3 } = await sb
        .from('questions')
        .insert({
          type: 'mcq',
          content: `${copyId}:Q3: StudentB, Bank1`,
          created_by: TEST_USERS.STUDENT2.id,
          organization_id: orgId,
          visibility: 'personal',
          bank_id: bank1Id,
        })
        .select()
        .single();
      q3Id = q3!.id;

      const { data: q4 } = await sb
        .from('questions')
        .insert({
          type: 'mcq',
          content: `${copyId}:Q4: StudentB, no group`,
          created_by: TEST_USERS.STUDENT2.id,
          organization_id: orgId,
          visibility: 'personal',
          bank_id: bank2Id,
        })
        .select()
        .single();
      q4Id = q4!.id;

      // Answers for Q1 (for p_question_id test)
      await sb.from('question_options').insert([
        { question_id: q1Id, content: 'Ans 1', is_correct: true, order_index: 0 },
        { question_id: q1Id, content: 'Ans 2', is_correct: false, order_index: 1 },
      ]);
    });

    afterAll(async () => {
      // Clean up ALL questions for test users (org cleanup won't touch them)
      for (const user of Object.values(TEST_USERS)) {
        await cleanupQuestions(user.id);
      }
      await cleanupOrganizationByName(ORG_PREFIX);
    });

    // ---------------------------------------------------------------
    // Scope tests — Student A (group member)
    // ---------------------------------------------------------------
    describe('scope — Student A (group member)', () => {
      it("p_scope='own' returns only own questions", async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
          p_org_id: orgId,
          p_scope: 'own',
        });

        const ids = (data as any[]).map((d: any) => d.id).sort();
        expect(ids).toEqual([q1Id, q2Id].sort());
      });

      it("p_scope='group' returns own + group-shared", async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
          p_org_id: orgId,
          p_scope: 'group',
        });

        const ids = (data as any[]).map((d: any) => d.id).sort();
        expect(ids).toEqual([q1Id, q2Id, q3Id].sort());
      });

      it("p_scope='organization' returns all questions in org", async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
          p_org_id: orgId,
          p_scope: 'organization',
        });

        const ids = (data as any[]).map((d: any) => d.id).sort();
        expect(ids).toEqual([q1Id, q2Id, q3Id, q4Id].sort());
      });

      it("p_scope='any' returns all questions in org", async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
          p_org_id: orgId,
          p_scope: 'any',
        });

        const ids = (data as any[]).map((d: any) => d.id).sort();
        expect(ids).toEqual([q1Id, q2Id, q3Id, q4Id].sort());
      });
    });

    // ---------------------------------------------------------------
    // Scope tests — Student B (NOT a group member)
    // ---------------------------------------------------------------
    describe('scope — Student B (not a group member)', () => {
      it("p_scope='own' returns only own questions", async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT2.id,
          p_org_id: orgId,
          p_scope: 'own',
        });

        const ids = (data as any[]).map((d: any) => d.id).sort();
        expect(ids).toEqual([q3Id, q4Id].sort());
      });

      it("p_scope='group' returns only own (no group access)", async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT2.id,
          p_org_id: orgId,
          p_scope: 'group',
        });

        // Student B has no group membership, so only own questions are returned
        const ids = (data as any[]).map((d: any) => d.id).sort();
        expect(ids).toEqual([q3Id, q4Id].sort());
      });

      it("p_scope='organization' returns all questions", async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT2.id,
          p_org_id: orgId,
          p_scope: 'organization',
        });

        expect((data as any[]).length).toBe(4);
      });
    });

    // ---------------------------------------------------------------
    // p_question_id — single lookup with answers
    // ---------------------------------------------------------------
    describe('p_question_id', () => {
      it('returns question with answers inline when accessible', async () => {
        const { data, error } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
          p_org_id: orgId,
          p_scope: 'own',
          p_question_id: q1Id,
        });

        expect(error).toBeNull();
        expect(data).toHaveLength(1);
        expect(data![0].id).toBe(q1Id);
        expect(data![0].question_options).toBeDefined();
        expect(Array.isArray(data![0].question_options)).toBe(true);
        expect(data![0].question_options).toHaveLength(2);
        expect(data![0].question_options[0].content).toBe('Ans 1');
        expect(data![0].question_options[0].is_correct).toBe(true);
      });

      it('returns empty when question is not accessible', async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT2.id,
          p_org_id: orgId,
          p_scope: 'group',
          p_question_id: q1Id, // Q1 belongs to Student A, not shared via group
        });

        expect(data).toHaveLength(0);
      });

      it('returns empty for nonexistent id', async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
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
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
          p_org_id: orgId,
          p_scope: 'organization',
          p_bank_ids: [bank1Id],
        });

        const ids = (data as any[]).map((d: any) => d.id).sort();
        expect(ids).toEqual([q1Id, q3Id].sort()); // Q1 and Q3 are in Bank1
      });

      it('p_type filters by type', async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
          p_org_id: orgId,
          p_scope: 'any',
          p_type: 'mcq',
        });

        expect((data as any[]).length).toBe(4); // All questions are mcq
      });

      it('p_type returns empty for non-matching type', async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
          p_org_id: orgId,
          p_scope: 'any',
          p_type: 'true_false',
        });

        expect(data).toHaveLength(0);
      });

      it('p_bank_ids returns empty for non-matching bank', async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
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
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
          p_org_id: null,
          p_scope: 'own',
        });

        // No org filter — returns Student A's own questions from any org
        const ids = (data as any[]).map((d: any) => d.id).sort();
        expect(ids).toEqual([q1Id, q2Id].sort());
      });
    });

    // ---------------------------------------------------------------
    // Default scope is 'own'
    // ---------------------------------------------------------------
    describe('default scope', () => {
      it("p_scope='own' returns own questions only (default scope)", async () => {
        const { data } = await createServiceClient().rpc('get_accessible_questions', {
          p_user_id: TEST_USERS.STUDENT.id,
          p_org_id: orgId,
          p_scope: 'own',
        });

        const ids = (data as any[]).map((d: any) => d.id).sort();
        expect(ids).toEqual([q1Id, q2Id].sort());
      });
    });
  });
});
