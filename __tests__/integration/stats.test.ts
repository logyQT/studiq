import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupFlashcards,
  cleanupOrganizationDeep,
  cleanupQuestions,
  cleanupQuizAttempts,
  cleanupTeacherAssignments,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { GET as studentGet } from '@/app/(backend)/api/v1/stats/student/route';
import { GET as quizzesGet } from '@/app/(backend)/api/v1/stats/teacher/quizzes/route';
import { GET as teacherGet } from '@/app/(backend)/api/v1/stats/teacher/route';

forEachCopy((copyId) => {
  describe(`Stats Integration [${copyId}]`, () => {
    registerMock(copyId, null);

    let teacher!: BeforeResult;
    let student!: BeforeResult;
    let scopedTeacher!: BeforeResult;
    let member!: TestUserFixture;
    let outsider!: TestUserFixture;
    let seedBankId!: string;
    let extraBankId!: string;

    const inOrgTitle = `seed-quizstats-in-org-${copyId}`;
    const outsiderTitle = `seed-quizstats-outside-${copyId}`;

    beforeAll(async () => {
      // Fresh educator with exactly 3 API-created questions + fresh student.
      teacher = await before({ role: 'educator', questions: 3 });
      student = await before({ role: 'student' });

      // Subject/type breakdown setup: the API-seeded questions all land in one
      // mcq bank; add a second bank holding a true_false + an open question so
      // the type split and the per-subject distribution can be exercised.
      const service = createServiceClient();
      const { data: seededQuestions } = await service
        .from('questions')
        .select('id, bank_id')
        .in('id', teacher.created.questions);
      const seededBankId = seededQuestions?.[0]?.bank_id;
      if (!seededBankId) throw new Error('[setup] seeded question bank not found');
      seedBankId = seededBankId;

      const { data: extraBank, error: extraBankError } = await service
        .from('question_banks')
        .insert({
          created_by: teacher.user.id,
          name: `seed-bank-extra-${copyId}`,
          visibility: 'personal',
        })
        .select('id')
        .single();
      if (extraBankError || !extraBank) {
        throw new Error(`[setup] extra bank insert failed: ${extraBankError?.message}`);
      }
      extraBankId = extraBank.id;

      const { error: extraQuestionsError } = await service.from('questions').insert([
        {
          bank_id: extraBankId,
          created_by: teacher.user.id,
          type: 'true_false',
          content: `seed-question-extra-${copyId}-0`,
        },
        {
          bank_id: extraBankId,
          created_by: teacher.user.id,
          type: 'open',
          content: `seed-question-extra-${copyId}-1`,
        },
      ]);
      if (extraQuestionsError) {
        throw new Error(`[setup] extra questions insert failed: ${extraQuestionsError.message}`);
      }

      // Educator with an org holding exactly one student member — mirrors the
      // EDU-ST-02 classroom setup for the teacher-quiz-stats scoping check.
      // Membership is seeded directly (like the other group-scoping suites)
      // because only the org admin can add members via the API.
      scopedTeacher = await before({ role: 'educator', org: `quizstats-org-${copyId}` });
      const orgId = scopedTeacher.orgId;
      if (!orgId) throw new Error('[setup] org not created');

      member = await createTestUser({ role: 'student' });
      outsider = await createTestUser({ role: 'student' });

      const { data: memberRole } = await service
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'member')
        .single();
      if (!memberRole) throw new Error('[setup] member org role not found');

      const { error: membershipError } = await service.from('org_members').insert({
        organization_id: orgId,
        user_id: member.id,
        org_role_id: memberRole.id,
      });
      if (membershipError) {
        throw new Error(`[setup] org membership failed: ${membershipError.message}`);
      }

      const now = Date.now();
      const { data: assignment, error: assignmentError } = await service
        .from('teacher_assignments')
        .insert({
          organization_id: orgId,
          created_by: scopedTeacher.user.id,
          title: `seed-quizstats-assignment-${copyId}`,
          status: 'published',
        })
        .select('id')
        .single();
      if (assignmentError || !assignment) {
        throw new Error(`[setup] assignment insert failed: ${assignmentError?.message}`);
      }

      const { error } = await service.from('quiz_attempts').insert([
        {
          user_id: member.id,
          score: 8,
          total_questions: 10,
          config: { title: inOrgTitle },
          started_at: new Date(now - 60 * 60 * 1000).toISOString(),
          completed_at: new Date(now - 59 * 60 * 1000).toISOString(),
        },
        {
          // Assignment attempt: scored in points (max = total_points) and
          // config-less, so it lands in the untitled bucket (#203).
          user_id: member.id,
          assignment_id: assignment.id,
          score: 6,
          total_points: 8,
          total_questions: 8,
          config: null,
          started_at: new Date(now - 50 * 60 * 1000).toISOString(),
          completed_at: new Date(now - 49 * 60 * 1000).toISOString(),
        },
        {
          user_id: outsider.id,
          score: 0,
          total_questions: 10,
          config: { title: outsiderTitle },
          started_at: new Date(now - 60 * 60 * 1000).toISOString(),
          completed_at: new Date(now - 59 * 60 * 1000).toISOString(),
        },
        {
          // Incomplete attempt: must never be counted.
          user_id: member.id,
          score: 3,
          total_questions: 10,
          config: { title: inOrgTitle },
          started_at: new Date(now - 30 * 60 * 1000).toISOString(),
          completed_at: null,
        },
      ]);
      if (error) throw new Error(`[setup] quiz attempts insert failed: ${error.message}`);
    });

    beforeEach(() => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
    });

    afterAll(async () => {
      for (const user of [teacher.user, student.user]) {
        await cleanupQuestions(user.id, 'seed-question-');
        await cleanupFlashcards(user.id);
        await cleanupQuizAttempts(user.id);
      }
      await cleanupQuizAttempts(member.id);
      await cleanupQuizAttempts(outsider.id);
      await cleanupTeacherAssignments(scopedTeacher.user.id);
      if (scopedTeacher.orgId) await cleanupOrganizationDeep(scopedTeacher.orgId);
    });

    describe('GET /api/v1/stats/teacher', () => {
      it('returns teacher stats', async () => {
        mockUser(teacher.user);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher');
        const response = await teacherGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.totalQuestions).toBeDefined();
        expect(body.data.totalFlashcards).toBeDefined();
      });

      it('returns totals plus the type and subject breakdowns', async () => {
        mockUser(teacher.user);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher');
        const response = await teacherGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.totalQuestions).toBe(5);
        expect(body.data.subject.byType).toEqual({ mcq: 3, true_false: 1, open: 1 });

        const bySubject = body.data.bySubject as Array<{
          subjectId: string;
          subjectName: string | null;
          questionCount: number;
        }>;
        expect(bySubject).toHaveLength(2);
        expect(bySubject.find((s) => s.subjectId === seedBankId)).toMatchObject({
          questionCount: 3,
          subjectName: expect.stringContaining('seed-bank-'),
        });
        expect(bySubject.find((s) => s.subjectId === extraBankId)).toMatchObject({
          subjectName: `seed-bank-extra-${copyId}`,
          questionCount: 2,
        });
      });

      it('narrows only the type split when ?subjectId= is provided', async () => {
        mockUser(teacher.user);

        const req = createNextRequest(
          `http://localhost/api/v1/stats/teacher?subjectId=${extraBankId}`,
        );
        const response = await teacherGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.subject.byType).toEqual({ true_false: 1, open: 1 });
        // Totals and the by-subject overview stay global.
        expect(body.data.totalQuestions).toBe(5);
        expect(body.data.bySubject).toHaveLength(2);
      });

      it('narrows the same split for an uppercase subject id', async () => {
        mockUser(teacher.user);

        const req = createNextRequest(
          `http://localhost/api/v1/stats/teacher?subjectId=${extraBankId.toUpperCase()}`,
        );
        const response = await teacherGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.subject.byType).toEqual({ true_false: 1, open: 1 });
        // Totals and the by-subject overview stay global.
        expect(body.data.totalQuestions).toBe(5);
        expect(body.data.bySubject).toHaveLength(2);
      });

      it('returns the seeded bank split for a known subject id', async () => {
        mockUser(teacher.user);

        const req = createNextRequest(
          `http://localhost/api/v1/stats/teacher?subjectId=${seedBankId}`,
        );
        const response = await teacherGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.subject.byType).toEqual({ mcq: 3 });
      });

      it('returns an empty type split for an unknown subject id', async () => {
        mockUser(teacher.user);

        const req = createNextRequest(
          'http://localhost/api/v1/stats/teacher?subjectId=00000000-0000-4000-8020-000000000099',
        );
        const response = await teacherGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.subject.byType).toEqual({});
        expect(body.data.totalQuestions).toBe(5);
      });

      it('returns 422 for a non-UUID subject id', async () => {
        mockUser(teacher.user);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher?subjectId=not-a-uuid');
        const response = await teacherGet(req);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
        expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher');
        const response = await teacherGet(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });
    });

    describe('GET /api/v1/stats/student', () => {
      it('returns student stats', async () => {
        mockUser(student.user);

        const req = createNextRequest('http://localhost/api/v1/stats/student');
        const response = await studentGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.totalQuizzes).toBeDefined();
        expect(body.data.avgScore).toBeDefined();
        expect(body.data.bestScore).toBeDefined();
        expect(body.data.flashcardsPracticed).toBeDefined();
      });

      it('returns zero stats when no data exists', async () => {
        mockUser(student.user);

        const req = createNextRequest('http://localhost/api/v1/stats/student');
        const response = await studentGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.totalQuizzes).toBe(0);
        expect(body.data.avgScore).toBe(0);
        expect(body.data.bestScore).toBe(0);
        expect(body.data.flashcardsPracticed).toBe(0);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest('http://localhost/api/v1/stats/student');
        const response = await studentGet(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });
    });

    // Regression for #205: the endpoint used to aggregate every completed
    // quiz_attempts row in the deployment (quiz_attempts has RLS disabled),
    // leaking another org's — or an org-less user's — activity into a
    // teacher's "Próby testów" card.
    describe('GET /api/v1/stats/teacher/quizzes', () => {
      it('counts only completed attempts of the active org students', async () => {
        mockUser(scopedTeacher.user);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher/quizzes', undefined, {
          active_org_id: scopedTeacher.orgId!,
        });
        const response = await quizzesGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data).toHaveLength(2);
        const titled = body.data.find((row: { title: string | null }) => row.title === inOrgTitle);
        expect(titled).toMatchObject({ totalAttempts: 1, avgScore: 80, avgCompletionRate: 10 });
        // The assignment attempt is normalised to its own scale: 6/8 = 75 %.
        const assignmentRow = body.data.find((row: { title: string | null }) => row.title === null);
        expect(assignmentRow).toMatchObject({ totalAttempts: 1, avgScore: 75 });
        expect(body.data.some((row: { title: string }) => row.title === outsiderTitle)).toBe(false);
      });

      it('returns no stats without an active organization (no global fallback)', async () => {
        mockUser(scopedTeacher.user);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher/quizzes');
        const response = await quizzesGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data).toEqual([]);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher/quizzes');
        const response = await quizzesGet(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });

      it('returns 403 for a student caller', async () => {
        mockUser(student.user);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher/quizzes', undefined, {
          active_org_id: scopedTeacher.orgId!,
        });
        const response = await quizzesGet(req);

        expect(response.status).toBe(403);
      });
    });
  });
});
