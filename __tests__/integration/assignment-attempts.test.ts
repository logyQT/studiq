import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupOrganizationDeep,
  cleanupQuestions,
  cleanupQuizAttempts,
  cleanupTeacherAssignments,
  createServiceClient,
  mockUser,
  seedOrgMembership,
} from '#test/integration/helpers';
import {
  createNextRequest,
  createNextRequestWithParams,
  requiredAt,
} from '#test/integration/test-utils';
import { asJson, json } from '#test/helpers/json';
import { GET as assignmentGet } from '@/app/(backend)/api/v1/assignments/[id]/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { GET as assignmentsList } from '@/app/(backend)/api/v1/assignments/route';
import {
  GET as attemptGet,
  POST as attemptPost,
} from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { GET as attemptsGet } from '@/app/(backend)/api/v1/quiz/attempts/route';
import { GET as studentStatsGet } from '@/app/(backend)/api/v1/stats/student/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

/** One attempt as the assignment/quiz payloads summarise it. */
type AttemptSummary = { id: string; completed_at: string | null; score: number | null };

/** `POST /api/v1/assignments/:id/start` — the opened (or resumed) attempt. */
type StartBody = {
  data: {
    id: string;
    questions: Array<{ id: string; question_answers?: Array<{ id: string }> }>;
  };
};

/** `POST /api/v1/quiz/:attemptId` — the graded attempt. */
type SubmitBody = { data: { score: number | null } };

/** `GET /api/v1/assignments/:id` — the student-facing assignment detail. */
type DetailBody = {
  data: {
    show_results: boolean;
    max_attempts: number;
    attempts_used: number;
    attempt: AttemptSummary;
    last_completed_attempt: AttemptSummary;
  };
};

/** A row of `GET /api/v1/assignments`. */
type AssignmentRow = {
  id: string;
  max_attempts: number;
  attempts_used: number;
  last_completed_attempt: AttemptSummary;
};

/** A row of `GET /api/v1/quiz/attempts` (`QuizzesTab`). */
type AttemptListRow = { id: string; completed_at: string | null; score: number | null };

/** `GET /api/v1/quiz/:attemptId` — the review payload. */
type ReviewBody = { data: { assignment_id: string; completed_at: string | null } };

/** The same review payload once submitted (questions + answers are revealed). */
type SubmittedReviewBody = {
  data: {
    assignment_id: string;
    completed_at: string | null;
    questions: Array<{ question_answers: Array<{ is_correct?: boolean }> }>;
    answers: Record<string, unknown>;
  };
};

/** `GET /api/v1/assignments` — the list rows under `data`. */
type AssignmentListBody = { data: AssignmentRow[] };

/** `GET /api/v1/stats/student`. */
type StudentStats = {
  totalQuizzes: number;
  avgScore: number | null;
  bestScore: number | null;
  attemptsOverTime: Array<Record<string, unknown>>;
};

describe(`Assignment Attempts Integration`, () => {
  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let other!: TestUserFixture;
  let nonTargeted!: TestUserFixture;
  let assignmentId: string;

  async function startAs(
    user: { id: string; role: string } | null,
  ): Promise<{ status: number; body: StartBody }> {
    mockUser(user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
    );
    const response = await assignmentStart(request, { params });
    return { status: response.status, body: await json<StartBody>(response) };
  }

  async function openAttemptCount(userId: string = student.user.id): Promise<number> {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('id')
      .eq('assignment_id', assignmentId)
      .eq('user_id', userId)
      .is('completed_at', null);
    if (error) throw new Error(`Failed to count open attempts: ${error.message}`);
    return dbRows(data).length;
  }

  async function setMaxAttempts(maxAttempts: number): Promise<void> {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('teacher_assignments')
      .update({ max_attempts: maxAttempts })
      .eq('id', assignmentId);
    if (error) throw new Error(`Failed to update max_attempts: ${error.message}`);
  }

  async function setShowResults(showResults: boolean): Promise<void> {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('teacher_assignments')
      .update({ show_results: showResults })
      .eq('id', assignmentId);
    if (error) throw new Error(`Failed to update show_results: ${error.message}`);
  }

  async function submitAttempt(attemptBody: StartBody): Promise<SubmitBody> {
    const attemptId = attemptBody.data.id;
    const firstQuestion = requiredAt(attemptBody.data.questions, 0, 'attempt question');

    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptId}`,
      { attemptId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId,
          answers: [
            {
              questionId: firstQuestion.id,
              selectedAnswerId: firstQuestion.question_answers?.[0]?.id,
            },
          ],
        }),
      },
    );
    const submitRes = await attemptPost(request, { params });
    expect(submitRes.status).toBe(200);
    return json<SubmitBody>(submitRes);
  }

  async function detail(): Promise<{ status: number; body: DetailBody }> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}`,
      { id: assignmentId },
    );
    const response = await assignmentGet(request, { params });
    return { status: response.status, body: await json<DetailBody>(response) };
  }

  async function listRow(): Promise<AssignmentRow> {
    mockUser(student.user);
    const request = createNextRequest('http://localhost/api/v1/assignments');
    const response = await assignmentsList(request);
    const body = await json<AssignmentListBody>(response);
    expect(response.status).toBe(200);
    return body.data.find((row) => row.id === assignmentId)!;
  }

  async function review(attemptId: string): Promise<{ status: number; body: ReviewBody }> {
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptId}`,
      { attemptId },
    );
    const response = await attemptGet(request, { params });
    return { status: response.status, body: await json<ReviewBody>(response) };
  }

  async function studentStats(): Promise<StudentStats> {
    mockUser(student.user);
    const response = await studentStatsGet(
      createNextRequest('http://localhost/api/v1/stats/student'),
    );
    expect(response.status).toBe(200);
    return (await json<{ data: StudentStats }>(response)).data;
  }

  /** The rows behind `/app/stats/results` (`QuizzesTab`). */
  async function attemptList(): Promise<AttemptListRow[]> {
    mockUser(student.user);
    const response = await attemptsGet(createNextRequest('http://localhost/api/v1/quiz/attempts'));
    expect(response.status).toBe(200);
    return (await json<{ data: AttemptListRow[] }>(response)).data;
  }

  beforeAll(async () => {
    // The assignment belongs to the teacher's organisation, and only its members can be targeted
    // (#235), so the student joins it; `other` stays outside.
    teacher = await before({ role: 'educator', org: true, questions: 2, assignment: true });
    student = await before({ role: 'student' });
    other = await createTestUser({ role: 'student' });
    // An organisation member who is not targeted: the path that must be refused for a missing
    // target rather than for a missing organisation membership.
    nonTargeted = await createTestUser({ role: 'student' });

    assignmentId = asJson<string>(teacher.created.assignmentId);
    if (!assignmentId) throw new Error('Assignment was not seeded');
    if (!teacher.orgId) throw new Error('Teacher organisation was not seeded');

    const { data: memberRole } = await createServiceClient()
      .from('org_roles')
      .select('id')
      .eq('organization_id', teacher.orgId)
      .eq('name', 'member')
      .single()
      .overrideTypes<{ id: string }, { merge: false }>();
    if (!memberRole) throw new Error('Member role not found for the teacher organisation');
    await seedOrgMembership({
      organizationId: teacher.orgId,
      userId: student.user.id,
      orgRoleId: memberRole.id,
    });
    await seedOrgMembership({
      organizationId: teacher.orgId,
      userId: nonTargeted.id,
      orgRoleId: memberRole.id,
    });

    mockUser(teacher.user);

    // Two seeded questions + the student as the only target, then publish.
    const { request: questionsReq, params: questionsParams } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: teacher.created.questions }),
      },
    );
    const questionsRes = await addQuestionsPost(questionsReq, { params: questionsParams });
    if (!questionsRes.ok) {
      throw new Error(`Failed to add questions: ${await questionsRes.text()}`);
    }

    const { request: targetsReq, params: targetsParams } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/targets`,
      { id: assignmentId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: [student.user.id] }),
      },
    );
    const targetsRes = await targetsPut(targetsReq, { params: targetsParams });
    if (!targetsRes.ok) {
      throw new Error(`Failed to set targets: ${await targetsRes.text()}`);
    }

    const { request: publishReq, params: publishParams } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    const publishRes = await publishPost(publishReq, { params: publishParams });
    if (!publishRes.ok) {
      throw new Error(`Failed to publish: ${await publishRes.text()}`);
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    useRealSupabase();
    // Keep the #369 cases (max_attempts = 1) independent of the retake cases
    // below, which raise the budget on the shared seeded assignment.
    await setMaxAttempts(1);
    // The seed default is `false`; pin it so the #374 cases stay isolated.
    await setShowResults(false);
    await cleanupQuizAttempts(student.user.id);
    await cleanupQuizAttempts(other.id);
    await cleanupQuizAttempts(nonTargeted.id);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupQuizAttempts(other.id);
    await cleanupQuizAttempts(nonTargeted.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    if (teacher.orgId) await cleanupOrganizationDeep(teacher.orgId);
    // `nonTargeted` is an account this file created; delete it after its rows are gone.
    const { error: deleteError } = await createServiceClient().auth.admin.deleteUser(
      nonTargeted.id,
    );
    if (deleteError) {
      throw new Error(`Failed to delete the non-targeted test account: ${deleteError.message}`);
    }
  });

  it('refuses a target outside the assignment organisation and keeps the existing ones (#235)', async () => {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/targets`,
      { id: assignmentId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: [student.user.id, other.id] }),
      },
    );
    const response = await targetsPut(request, { params });

    expect(response.status).toBe(400);
    const { data: targets } = await createServiceClient()
      .from('assignment_targets')
      .select('student_id')
      .eq('assignment_id', assignmentId)
      .overrideTypes<{ student_id: string }[], { merge: false }>();
    expect((targets ?? []).map((t) => t.student_id)).toEqual([student.user.id]);
  });

  it('two rapid starts resume one unfinished attempt (#369)', async () => {
    mockUser(student.user);

    const first = await startAs(student.user);
    const second = await startAs(student.user);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.id).toBe(second.body.data.id);
    expect(await openAttemptCount()).toBe(1);
  });

  it('concurrent starts never produce a second open attempt (#369)', async () => {
    mockUser(student.user);

    const [first, second] = await Promise.all([startAs(student.user), startAs(student.user)]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.data.id).toBe(second.body.data.id);
    expect(await openAttemptCount()).toBe(1);
  });

  it('resumes with the same attempt id and its question snapshot, never the answer key (#369, #331)', async () => {
    const started = await startAs(student.user);
    expect(started.status).toBe(200);

    const resumed = await startAs(student.user);
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.id).toBe(started.body.data.id);
    expect(resumed.body.data.questions).toHaveLength(2);
    expect(resumed.body.data).not.toHaveProperty('draft_answers');
    for (const question of resumed.body.data.questions) {
      expect(question).not.toHaveProperty('explanation');
      expect(question).not.toHaveProperty('search_vector');
      for (const option of question.question_answers ?? []) {
        expect(option).not.toHaveProperty('is_correct');
      }
    }
  });

  it('the detail endpoint reports the running attempt after a quit (#369)', async () => {
    const started = await startAs(student.user);
    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}`,
      { id: assignmentId },
    );
    const response = await assignmentGet(request, { params });
    const body = await json<DetailBody>(response);

    expect(response.status).toBe(200);
    expect(body.data.attempt.id).toBe(started.body.data.id);
    expect(body.data.attempt.completed_at).toBeNull();
  });

  it('a submitted attempt cannot start again when max_attempts is 1 (#369)', async () => {
    const started = await startAs(student.user);
    const attemptId = started.body.data.id;
    const firstQuestion = requiredAt(started.body.data.questions, 0, 'attempt question');

    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptId}`,
      { attemptId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId,
          answers: [
            {
              questionId: firstQuestion.id,
              selectedAnswerId: firstQuestion.question_answers?.[0]?.id,
            },
          ],
        }),
      },
    );
    const submitRes = await attemptPost(request, { params });
    expect(submitRes.status).toBe(200);

    const restart = await startAs(student.user);
    expect(restart.status).toBe(429);
    expect(await openAttemptCount()).toBe(0);
  });

  it('returns 404 for an organisation member who is not targeted (#369)', async () => {
    const result = await startAs(nonTargeted);
    expect(result.status).toBe(404);
    expect(await openAttemptCount(nonTargeted.id)).toBe(0);
  });

  it('returns 404 for a student outside the assignment organisation (#369, #235)', async () => {
    const result = await startAs(other);
    expect(result.status).toBe(404);
    expect(await openAttemptCount(other.id)).toBe(0);
  });

  it('exposes the remaining budget after the first of two attempts (#372)', async () => {
    await setMaxAttempts(2);
    mockUser(student.user);

    const started = await startAs(student.user);
    expect(started.status).toBe(200);
    const attempt1 = started.body.data.id;

    await submitAttempt(started.body);

    const detailResult = await detail();
    expect(detailResult.status).toBe(200);
    expect(detailResult.body.data.max_attempts).toBe(2);
    expect(detailResult.body.data.attempts_used).toBe(1);
    expect(detailResult.body.data.attempt.id).toBe(attempt1);
    expect(detailResult.body.data.attempt.completed_at).not.toBeNull();
    expect(detailResult.body.data.last_completed_attempt.id).toBe(attempt1);
    expect(detailResult.body.data.attempt).not.toHaveProperty('draft_answers');

    const row = await listRow();
    expect(row).toBeDefined();
    expect(row.max_attempts).toBe(2);
    expect(row.attempts_used).toBe(1);
    expect(row.last_completed_attempt.id).toBe(attempt1);
  });

  it('the detail last completed attempt resolves to the review payload (#175)', async () => {
    await setMaxAttempts(2);
    // The review payload is only served when the teacher shares results.
    await setShowResults(true);
    mockUser(student.user);

    const started = await startAs(student.user);
    expect(started.status).toBe(200);
    const submittedAttemptId = started.body.data.id;
    await submitAttempt(started.body);

    // The review page without ?attemptId falls back to this row.
    const detailResult = await detail();
    expect(detailResult.status).toBe(200);
    expect(detailResult.body.data.last_completed_attempt.id).toBe(submittedAttemptId);

    mockUser(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${submittedAttemptId}`,
      { attemptId: submittedAttemptId },
    );
    const response = await attemptGet(request, { params });
    const body = await json<SubmittedReviewBody>(response);

    expect(response.status).toBe(200);
    expect(body.data.assignment_id).toBe(assignmentId);
    expect(body.data.completed_at).not.toBeNull();
    expect(body.data.questions).toHaveLength(2);
    expect(Object.keys(body.data.answers).length).toBeGreaterThan(0);
    for (const question of body.data.questions) {
      expect(question.question_answers.length).toBeGreaterThan(0);
      for (const option of question.question_answers) {
        expect(typeof option.is_correct).toBe('boolean');
      }
    }
  });

  it('starts the second attempt once the first is submitted (#372)', async () => {
    await setMaxAttempts(2);
    mockUser(student.user);

    const started1 = await startAs(student.user);
    const attempt1 = started1.body.data.id;
    await submitAttempt(started1.body);

    const started2 = await startAs(student.user);
    expect(started2.status).toBe(200);
    const attempt2 = started2.body.data.id;
    expect(attempt2).not.toBe(attempt1);
    expect(await openAttemptCount()).toBe(1);

    const detailResult = await detail();
    expect(detailResult.status).toBe(200);
    expect(detailResult.body.data.attempts_used).toBe(1);
    expect(detailResult.body.data.attempt.id).toBe(attempt2);
    expect(detailResult.body.data.attempt.completed_at).toBeNull();
    expect(detailResult.body.data.last_completed_attempt.id).toBe(attempt1);
  });

  it('refuses another start once max_attempts is exhausted (#372)', async () => {
    await setMaxAttempts(2);
    mockUser(student.user);

    const started1 = await startAs(student.user);
    await submitAttempt(started1.body);
    const started2 = await startAs(student.user);
    await submitAttempt(started2.body);

    const start3 = await startAs(student.user);
    expect(start3.status).toBe(429);
    expect(await openAttemptCount()).toBe(0);

    const detailResult = await detail();
    expect(detailResult.status).toBe(200);
    expect(detailResult.body.data.attempts_used).toBe(2);
    expect(detailResult.body.data.attempt.id).toBe(started2.body.data.id);
    expect(detailResult.body.data.attempt.completed_at).not.toBeNull();
    expect(detailResult.body.data.last_completed_attempt.id).toBe(started2.body.data.id);

    const row = await listRow();
    expect(row.attempts_used).toBe(2);
  });

  // The #374 cases below assert the service rule, not RLS: `mockUser` swaps in
  // the service-role client, so the `teacher_assignments` read bypasses the
  // student's row policy (the RLS-gated read was verified live in review 1).
  it('hides the score, review and stats while show_results is off (#374)', async () => {
    await setShowResults(false);
    mockUser(student.user);

    const started = await startAs(student.user);
    expect(started.status).toBe(200);
    const attemptId = started.body.data.id;

    const submitted = await submitAttempt(started.body);
    expect(submitted.data.score).toBeNull();

    const detailResult = await detail();
    expect(detailResult.status).toBe(200);
    expect(detailResult.body.data.show_results).toBe(false);
    // Completion metadata stays, only the result is withheld.
    expect(detailResult.body.data.last_completed_attempt.id).toBe(attemptId);
    expect(detailResult.body.data.last_completed_attempt.score).toBeNull();

    const row = await listRow();
    expect(row.last_completed_attempt.id).toBe(attemptId);
    expect(row.last_completed_attempt.score).toBeNull();

    // `/app/stats/results` keeps the attempt in the history but withholds its result.
    const historyRow = (await attemptList()).find((attempt) => attempt.id === attemptId);
    expect(historyRow).toBeDefined();
    expect(historyRow?.completed_at).not.toBeNull();
    expect(historyRow?.score).toBeNull();

    const hiddenReview = await review(attemptId);
    expect(hiddenReview.status).toBe(403);

    const stats = await studentStats();
    expect(stats.totalQuizzes).toBe(1);
    // Nothing gradable is visible, so there is no result to report (#374/#619).
    expect(stats.avgScore).toBeNull();
    expect(stats.bestScore).toBeNull();
    expect(stats.attemptsOverTime).toEqual([]);
  });

  it('reveals the score and review once show_results is on (#374)', async () => {
    await setShowResults(false);
    mockUser(student.user);

    const started = await startAs(student.user);
    const attemptId = started.body.data.id;
    await submitAttempt(started.body);

    await setShowResults(true);

    const detailResult = await detail();
    expect(detailResult.status).toBe(200);
    expect(detailResult.body.data.show_results).toBe(true);
    expect(typeof detailResult.body.data.last_completed_attempt.score).toBe('number');

    // The same history row now carries the real score.
    const historyRow = (await attemptList()).find((attempt) => attempt.id === attemptId);
    expect(historyRow).toBeDefined();
    expect(typeof historyRow?.score).toBe('number');

    const visibleReview = await review(attemptId);
    expect(visibleReview.status).toBe(200);
    expect(visibleReview.body.data.assignment_id).toBe(assignmentId);
    expect(visibleReview.body.data.completed_at).not.toBeNull();

    const stats = await studentStats();
    expect(stats.totalQuizzes).toBe(1);
    expect(stats.attemptsOverTime).toHaveLength(1);
  });
});
