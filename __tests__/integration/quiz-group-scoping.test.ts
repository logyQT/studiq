import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  cleanupQuestions,
  cleanupQuizAttempts,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { POST as createBankPost } from '@/app/(backend)/api/v1/questions/banks/route';
import { POST as createQuestionPost } from '@/app/(backend)/api/v1/questions/route';
import { POST as generateQuiz } from '@/app/(backend)/api/v1/quiz/new/route';

/**
 * Regression coverage for quiz.service.ts's generateQuiz(): it used to pull
 * questions with a manual `organization_id.eq.X OR created_by.eq.Y` filter,
 * ignoring group visibility entirely — the same class of leak fixed for the
 * spaced-repetition practice RPCs earlier. It now goes through
 * accessibleFilter() like question.service.ts already did. This asserts an
 * org member of a group a question bank was *not* shared with can't draw
 * that bank's questions into a generated quiz.
 */
forEachCopy((copyId) => {
  describe(`Quiz Group Scoping [${copyId}]`, () => {
    registerMock(copyId, null);

    let teacher!: BeforeResult;
    let studentInGroupA!: TestUserFixture;
    let studentInGroupB!: TestUserFixture;
    let bankId!: string;

    beforeAll(async () => {
      teacher = await before({
        role: 'educator',
        org: `quiz-scope-org-${copyId}`,
        groups: 2,
      });
      const orgId = teacher.orgId;
      if (!orgId) throw new Error('[setup] org not created');
      const groupA = teacher.groups[1];
      const groupB = teacher.groups[2];

      const service = createServiceClient();
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
      const bankReq = createNextRequest(
        'http://localhost/api/v1/questions/banks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `quiz-scope-bank-${copyId}`,
            visibility: 'group',
            groupIds: [groupA],
          }),
        },
        { active_org_id: orgId },
      );
      const bankRes = await createBankPost(bankReq);
      const bankBody = await bankRes.json();
      if (!bankRes.ok || !bankBody.success) {
        throw new Error(`[setup] bank creation failed: ${JSON.stringify(bankBody)}`);
      }
      bankId = bankBody.data.id as string;

      const questionReq = createNextRequest(
        'http://localhost/api/v1/questions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bankId,
            type: 'mcq',
            content: `quiz-scope-question-${copyId}`,
            answers: [
              { content: 'a', isCorrect: true, orderIndex: 0 },
              { content: 'b', isCorrect: false, orderIndex: 1 },
              { content: 'c', isCorrect: false, orderIndex: 2 },
            ],
          }),
        },
        { active_org_id: orgId },
      );
      const questionRes = await createQuestionPost(questionReq);
      const questionBody = await questionRes.json();
      if (!questionRes.ok || !questionBody.success) {
        throw new Error(`[setup] question creation failed: ${JSON.stringify(questionBody)}`);
      }
    });

    afterAll(async () => {
      await cleanupQuizAttempts(studentInGroupA.id);
      await cleanupQuizAttempts(studentInGroupB.id);
      await cleanupQuestions(teacher.user.id, 'quiz-scope-question-');
      const service = createServiceClient();
      if (bankId) await service.from('question_banks').delete().eq('id', bankId);
      if (teacher.orgId) await cleanupOrganizationDeep(teacher.orgId);
    });

    it('only the group member can draw the group-shared bank into a generated quiz', async () => {
      mockUser(studentInGroupA);
      const reqA = createNextRequest(
        'http://localhost/api/v1/quiz/new',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionTypes: ['mcq'], questionCount: 1, bankId }),
        },
        { active_org_id: teacher.orgId! },
      );
      const resA = await generateQuiz(reqA);
      const bodyA = await resA.json();
      expect(resA.status).toBe(201);
      expect(bodyA.data.questions.length).toBe(1);

      mockUser(studentInGroupB);
      const reqB = createNextRequest(
        'http://localhost/api/v1/quiz/new',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionTypes: ['mcq'], questionCount: 1, bankId }),
        },
        { active_org_id: teacher.orgId! },
      );
      const resB = await generateQuiz(reqB);
      const bodyB = await resB.json();
      expect(resB.status).toBe(404);
      expect(bodyB.success).toBe(false);
    });
  });
});
