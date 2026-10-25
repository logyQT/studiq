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
import { GET as flashcardTeacherStatsGet } from '@/app/(backend)/api/v1/flashcards/stats/teacher/route';
import { GET as studentGet } from '@/app/(backend)/api/v1/stats/student/route';
import { GET as activityGet } from '@/app/(backend)/api/v1/stats/teacher/activity/route';
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
          // Started but never finished (#212): counts as an attempt, never as a
          // completed one, and never contributes to avgScore.
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

      // #189: the proxy skips /api/*, so withAuth's allowedAccountTypes is the
      // only gate. A student used to get a 200 here (own data), and the
      // activity sibling leaked the org roster to any member of that org.
      it('returns 403 for a student caller on the teacher-stats family (#189)', async () => {
        mockUser(member);
        const orgCookie = { active_org_id: scopedTeacher.orgId! };

        const plain = await teacherGet(createNextRequest('http://localhost/api/v1/stats/teacher'));
        const activity = await activityGet(
          createNextRequest(
            'http://localhost/api/v1/stats/teacher/activity?range=30d',
            undefined,
            orgCookie,
          ),
        );
        const flashcards = await flashcardTeacherStatsGet(
          createNextRequest(
            'http://localhost/api/v1/flashcards/stats/teacher',
            undefined,
            orgCookie,
          ),
        );

        expect(plain.status).toBe(403);
        expect(activity.status).toBe(403);
        expect(flashcards.status).toBe(403);
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

    // Regression for #205: the endpoint used to aggregate every quiz_attempts
    // row in the deployment instead of the active org's students, leaking
    // another org's — or an org-less user's — activity into a teacher's
    // "Próby testów" card. RLS ("Own or same-org quiz attempts") is only a
    // same-org floor, so the service-level `user_id` scope stays required.
    describe('GET /api/v1/stats/teacher/quizzes', () => {
      it('aggregates the active org students with completion = completed / started', async () => {
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
        // One completed (8/10) plus one started-but-unfinished attempt: the
        // unfinished one only enters the attempts denominator (#212).
        expect(titled).toMatchObject({ totalAttempts: 2, avgScore: 80, avgCompletionRate: 50 });
        // The assignment attempt is normalised to its own scale: 6/8 = 75 %.
        const assignmentRow = body.data.find((row: { title: string | null }) => row.title === null);
        expect(assignmentRow).toMatchObject({
          totalAttempts: 1,
          avgScore: 75,
          avgCompletionRate: 100,
        });
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

    // Regression for #204 (EDU-ST-02): „Problematyczne pytania” read
    // `subject.problematicQuestions`, which `GET /api/v1/stats/teacher` never
    // produced — the card always showed its empty state.
    describe('GET /api/v1/stats/teacher — problematic questions (#204)', () => {
      let pqTeacher!: BeforeResult;
      let pqOtherTeacher!: TestUserFixture;
      let pqMember!: TestUserFixture;
      let pqOutsider!: TestUserFixture;
      let pqBankId!: string;
      let pqForeignBankId!: string;
      let problematicId!: string;
      let healthyId!: string;
      let multiId!: string;
      let openId!: string;
      let foreignId!: string;

      beforeAll(async () => {
        pqTeacher = await before({ role: 'educator', org: `problematic-org-${copyId}` });
        const orgId = pqTeacher.orgId;
        if (!orgId) throw new Error('[setup] org not created');

        const service = createServiceClient();
        pqMember = await createTestUser({ role: 'student' });
        pqOutsider = await createTestUser({ role: 'student' });
        pqOtherTeacher = await createTestUser({ role: 'educator' });

        const { data: roles } = await service
          .from('org_roles')
          .select('id, name')
          .eq('organization_id', orgId);
        const memberRole = roles?.find((r) => r.name === 'member');
        const teacherRole = roles?.find((r) => r.name === 'teacher');
        if (!memberRole || !teacherRole) throw new Error('[setup] org roles not found');

        const { error: membershipError } = await service.from('org_members').insert([
          { organization_id: orgId, user_id: pqMember.id, org_role_id: memberRole.id },
          { organization_id: orgId, user_id: pqOtherTeacher.id, org_role_id: teacherRole.id },
        ]);
        if (membershipError) {
          throw new Error(`[setup] org membership failed: ${membershipError.message}`);
        }

        const { data: bank, error: bankError } = await service
          .from('question_banks')
          .insert({
            created_by: pqTeacher.user.id,
            organization_id: orgId,
            name: `seed-bank-problematic-${copyId}`,
            visibility: 'group',
          })
          .select('id')
          .single();
        if (bankError || !bank)
          throw new Error(`[setup] bank insert failed: ${bankError?.message}`);
        pqBankId = bank.id;

        const { data: foreignBank, error: foreignBankError } = await service
          .from('question_banks')
          .insert({
            created_by: pqOtherTeacher.id,
            organization_id: orgId,
            name: `seed-bank-foreign-${copyId}`,
            visibility: 'group',
          })
          .select('id')
          .single();
        if (foreignBankError || !foreignBank) {
          throw new Error(`[setup] foreign bank insert failed: ${foreignBankError?.message}`);
        }
        pqForeignBankId = foreignBank.id;

        const { data: questions, error: questionsError } = await service
          .from('questions')
          .insert([
            {
              bank_id: pqBankId,
              created_by: pqTeacher.user.id,
              organization_id: orgId,
              type: 'mcq',
              content: `seed-problematic-${copyId}`,
            },
            {
              bank_id: pqBankId,
              created_by: pqTeacher.user.id,
              organization_id: orgId,
              type: 'mcq',
              content: `seed-healthy-${copyId}`,
            },
            {
              bank_id: pqBankId,
              created_by: pqTeacher.user.id,
              organization_id: orgId,
              type: 'multi_select',
              content: `seed-multi-${copyId}`,
            },
            {
              bank_id: pqBankId,
              created_by: pqTeacher.user.id,
              organization_id: orgId,
              type: 'open',
              content: `seed-open-${copyId}`,
            },
            {
              bank_id: pqForeignBankId,
              created_by: pqOtherTeacher.id,
              organization_id: orgId,
              type: 'mcq',
              content: `seed-foreign-${copyId}`,
            },
          ])
          .select('id, content');
        if (questionsError || !questions) {
          throw new Error(`[setup] questions insert failed: ${questionsError?.message}`);
        }
        const questionId = (content: string) => {
          const row = questions.find((q) => q.content === content);
          if (!row) throw new Error(`[setup] question ${content} not found`);
          return row.id as string;
        };
        problematicId = questionId(`seed-problematic-${copyId}`);
        healthyId = questionId(`seed-healthy-${copyId}`);
        multiId = questionId(`seed-multi-${copyId}`);
        openId = questionId(`seed-open-${copyId}`);
        foreignId = questionId(`seed-foreign-${copyId}`);

        const now = Date.now();
        const { data: memberAttempts, error: attemptsError } = await service
          .from('quiz_attempts')
          .insert(
            Array.from({ length: 5 }, (_, i) => ({
              user_id: pqMember.id,
              total_questions: 4,
              config: { title: `seed-problematic-attempt-${copyId}` },
              started_at: new Date(now - (i + 1) * 60_000).toISOString(),
              completed_at: new Date(now - (i + 1) * 60_000 + 30_000).toISOString(),
            })),
          )
          .select('id, started_at');
        if (attemptsError || !memberAttempts) {
          throw new Error(`[setup] attempts insert failed: ${attemptsError?.message}`);
        }
        // Worst-first within the fixture: the first two attempts answer correctly.
        const attemptIds = [...memberAttempts]
          .sort((a, b) => (a.started_at as string).localeCompare(b.started_at as string))
          .map((a) => a.id as string);

        const { data: extraAttempts, error: extraAttemptsError } = await service
          .from('quiz_attempts')
          .insert([
            {
              // Not an org learner — must not enter the denominator.
              user_id: pqOutsider.id,
              total_questions: 4,
              config: { title: `seed-outsider-attempt-${copyId}` },
              started_at: new Date(now - 60_000).toISOString(),
              completed_at: new Date(now - 30_000).toISOString(),
            },
            {
              // The teacher's own practice attempt — also excluded.
              user_id: pqTeacher.user.id,
              total_questions: 4,
              config: { title: `seed-teacher-attempt-${copyId}` },
              started_at: new Date(now - 60_000).toISOString(),
              completed_at: new Date(now - 30_000).toISOString(),
            },
            {
              // Unfinished — answers must not be counted.
              user_id: pqMember.id,
              total_questions: 4,
              config: { title: `seed-problematic-attempt-${copyId}` },
              started_at: new Date(now - 60_000).toISOString(),
              completed_at: null,
            },
          ])
          .select('id, user_id');
        if (extraAttemptsError || !extraAttempts) {
          throw new Error(`[setup] extra attempts insert failed: ${extraAttemptsError?.message}`);
        }
        const outsiderAttemptId = extraAttempts.find((a) => a.user_id === pqOutsider.id)?.id;
        const teacherAttemptId = extraAttempts.find((a) => a.user_id === pqTeacher.user.id)?.id;
        const unfinishedAttemptId = extraAttempts.find((a) => a.user_id === pqMember.id)?.id;

        const answers: Array<{
          attempt_id: string;
          question_id: string;
          is_correct: boolean;
        }> = [];
        attemptIds.forEach((attemptId, index) => {
          answers.push({
            attempt_id: attemptId,
            question_id: problematicId,
            is_correct: index < 2, // 2/5 = 40 %
          });
          answers.push({
            attempt_id: attemptId,
            question_id: healthyId,
            is_correct: index < 3, // 3/5 = 60 % → not problematic
          });
          // Multi-select stores one row per chosen option: two rows per attempt
          // must still count as ONE answer (bool_or), not two.
          answers.push(
            { attempt_id: attemptId, question_id: multiId, is_correct: index < 2 },
            { attempt_id: attemptId, question_id: multiId, is_correct: false },
          );
          answers.push({
            attempt_id: attemptId,
            question_id: openId,
            is_correct: false, // ungraded free text → excluded
          });
        });
        if (outsiderAttemptId) {
          answers.push({
            attempt_id: outsiderAttemptId,
            question_id: problematicId,
            is_correct: true,
          });
        }
        if (teacherAttemptId) {
          answers.push({
            attempt_id: teacherAttemptId,
            question_id: problematicId,
            is_correct: true,
          });
        }
        if (unfinishedAttemptId) {
          answers.push({
            attempt_id: unfinishedAttemptId,
            question_id: problematicId,
            is_correct: true,
          });
        }

        const { error: answersError } = await service.from('student_answers').insert(answers);
        if (answersError) {
          throw new Error(`[setup] student answers insert failed: ${answersError.message}`);
        }
      });

      afterAll(async () => {
        await cleanupQuizAttempts(pqMember.id);
        await cleanupQuizAttempts(pqOutsider.id);
        await cleanupQuizAttempts(pqTeacher.user.id);
        await cleanupQuestions(pqTeacher.user.id);
        await cleanupQuestions(pqOtherTeacher.id);
        if (pqTeacher.orgId) await cleanupOrganizationDeep(pqTeacher.orgId);
      });

      it('lists the 40 % question and keeps healthy, open and foreign ones out', async () => {
        mockUser(pqTeacher.user);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher', undefined, {
          active_org_id: pqTeacher.orgId!,
        });
        const response = await teacherGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);

        const problematic = body.data.subject.problematicQuestions as Array<{
          id: string;
          correctRate: number;
          totalAnswers: number;
        }>;
        const reported = problematic.find((q) => q.id === problematicId);
        expect(reported).toBeDefined();
        expect(reported?.correctRate).toBeCloseTo(0.4, 4);
        // 5 completed learner attempts; the teacher's own, the outsider's and
        // the unfinished attempt must not inflate the denominator.
        expect(reported?.totalAnswers).toBe(5);

        expect(problematic.some((q) => q.id === healthyId)).toBe(false);
        expect(problematic.some((q) => q.id === openId)).toBe(false);
        expect(problematic.some((q) => q.id === foreignId)).toBe(false);

        // byType covers the same scoped questions, so the count cards agree.
        expect(body.data.totalQuestions).toBe(4);
        expect(body.data.subject.byType).toEqual({ mcq: 2, multi_select: 1, open: 1 });
      });

      it('counts a multi-row attempt once, not once per answer row', async () => {
        mockUser(pqTeacher.user);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher', undefined, {
          active_org_id: pqTeacher.orgId!,
        });
        const response = await teacherGet(req);
        const body = await response.json();

        const multi = (
          body.data.subject.problematicQuestions as Array<{
            id: string;
            correctRate: number;
            totalAnswers: number;
          }>
        ).find((q) => q.id === multiId);
        expect(multi).toBeDefined();
        // 10 answer rows → 5 attempts, 2 of them correct.
        expect(multi?.totalAnswers).toBe(5);
        expect(multi?.correctRate).toBeCloseTo(0.4, 4);
      });

      it('sorts worst-first', async () => {
        mockUser(pqTeacher.user);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher', undefined, {
          active_org_id: pqTeacher.orgId!,
        });
        const response = await teacherGet(req);
        const body = await response.json();

        const rates = (
          body.data.subject.problematicQuestions as Array<{ correctRate: number }>
        ).map((q) => q.correctRate);
        expect(rates).toEqual([...rates].sort((a, b) => a - b));
      });

      it('narrows the list to the ?subjectId= bank', async () => {
        mockUser(pqTeacher.user);

        const req = createNextRequest(
          `http://localhost/api/v1/stats/teacher?subjectId=${pqForeignBankId}`,
          undefined,
          { active_org_id: pqTeacher.orgId! },
        );
        const response = await teacherGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.subject.problematicQuestions).toEqual([]);
      });

      it('stays tenant-scoped without an active organization', async () => {
        mockUser(pqTeacher.user);

        const req = createNextRequest('http://localhost/api/v1/stats/teacher');
        const response = await teacherGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        const reported = (
          body.data.subject.problematicQuestions as Array<{ id: string; totalAnswers: number }>
        ).find((q) => q.id === problematicId);
        expect(reported?.totalAnswers).toBe(5);
      });
    });
  });
});
