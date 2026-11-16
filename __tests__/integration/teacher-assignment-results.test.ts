import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson, json } from '#test/helpers/json';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
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
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { POST as attemptSubmit } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { GET as resultsGet } from '@/app/(backend)/api/v1/teacher/assignments/[id]/results/route';
import { PUT as gradePut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/results/[studentId]/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

/**
 * `GET /api/v1/teacher/assignments/:id/results` is the data source of the
 * per-question grading view (`/edu/assignments/:id/results/question/:qId`), which
 * grades one question across the whole class. It therefore has to carry each
 * attempt's answer rows — the view used to crash on the missing key (#1230).
 */

const DEADLINE = new Date(Date.now() + 2 * 86_400_000).toISOString();

interface StartedAttempt {
  id: string;
  questions: Array<{
    id: string;
    question_answers?: Array<{ id: string; content: string }>;
  }>;
}

/** A row of `GET /api/v1/teacher/assignments/:id/results`. */
interface ResultsRow {
  id: string;
  user_id: string;
  score: number | null;
  quiz_answers: Array<{
    question_id: string;
    selected_option_id: string | null;
    /** The published option's text, resolved from the frozen snapshot (#1238). */
    selected_option_content: string | null;
    teacher_points: number | null;
    teacher_feedback: string | null;
  }>;
  assignment_answer_images: Array<{ question_id: string; image_url: string }>;
}

/**
 * Edits the live item the way the author editor does — a new stem and a fresh option set. The
 * published snapshot must keep serving the option the student picked (#1238).
 */
async function editLiveQuestion(id: string): Promise<void> {
  const service = createServiceClient();
  const { error: stemError } = await service
    .from('questions')
    .update({ content: `seed-question-edited-${Date.now()}` })
    .eq('id', id);
  if (stemError) throw new Error(stemError.message);

  const { error: dropError } = await service
    .from('question_options')
    .delete()
    .eq('question_id', id);
  if (dropError) throw new Error(dropError.message);

  const { error } = await service.from('question_options').insert([
    { question_id: id, content: 'edited-after-publish-a', is_correct: true, order_index: 0 },
    { question_id: id, content: 'edited-after-publish-b', is_correct: false, order_index: 1 },
  ]);
  if (error) throw new Error(error.message);
}

describe('Teacher assignment results payload (#1230)', () => {
  let teacher!: BeforeResult;
  let answering!: BeforeResult;
  let silent!: BeforeResult;
  let assignmentId!: string;
  let questionId!: string;
  /** The option text the student picked, as published (the live item is edited after publish). */
  let publishedOptionContent!: string;
  let answeringAttemptId!: string;
  let silentAttemptId!: string;

  const cookie = () => ({ active_org_id: teacher.orgId ?? '' });

  async function results(): Promise<ResultsRow[]> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/results`,
      { id: assignmentId },
      {},
      cookie(),
    );
    const response = await resultsGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: { attempts: ResultsRow[] } }>(response)).data.attempts;
  }

  async function start(user: BeforeResult): Promise<StartedAttempt> {
    mockUser(user.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    const response = await assignmentStart(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: StartedAttempt }>(response)).data;
  }

  async function submit(
    user: BeforeResult,
    attempt: StartedAttempt,
    answers: Array<Record<string, string>>,
  ): Promise<void> {
    mockUser(user.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, answers }),
      },
      cookie(),
    );
    const response = await attemptSubmit(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
  }

  async function grade(attemptId: string, points: number, feedback: string): Promise<number> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/results/${attemptId}`,
      { id: assignmentId, studentId: attemptId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId, points, feedback }),
      },
      cookie(),
    );
    return (await gradePut(request, { params })).status;
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, questions: 2 });
    answering = await before({ role: 'student' });
    silent = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');

    const service = createServiceClient();
    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', teacher.orgId)
      .eq('name', 'member')
      .single();
    for (const student of [answering, silent]) {
      await seedOrgMembership({
        organizationId: teacher.orgId,
        userId: student.user.id,
        orgRoleId: asJson<{ id: string }>(memberRole).id,
      });
    }

    const questionIds = teacher.created.questions.slice(0, 2);
    questionId = requiredAt(questionIds, 0, 'the graded question');

    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `results-payload-${Date.now()}` }),
        },
        cookie(),
      ),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    assignmentId = (await json<{ data: { id: string } }>(created)).data.id;

    const added = await addQuestionsPost(
      createNextRequestWithParams(
        `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
        { id: assignmentId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionIds }),
        },
        cookie(),
      ).request,
      { params: Promise.resolve({ id: assignmentId }) },
    );
    expect(added.status, await added.clone().text()).toBe(200);

    const targeted = await targetsPut(
      createNextRequestWithParams(
        `http://localhost/api/v1/teacher/assignments/${assignmentId}/targets`,
        { id: assignmentId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentIds: [answering.user.id, silent.user.id] }),
        },
        cookie(),
      ).request,
      { params: Promise.resolve({ id: assignmentId }) },
    );
    expect(targeted.status, await targeted.clone().text()).toBe(200);

    const published = await publishPost(
      createNextRequestWithParams(
        `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
        { id: assignmentId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deadline: DEADLINE, acknowledgeExposure: true }),
        },
        cookie(),
      ).request,
      { params: Promise.resolve({ id: assignmentId }) },
    );
    expect(published.status, await published.clone().text()).toBe(200);

    // One attempt answers the graded question; the other submits nothing at all.
    const answered = await start(answering);
    answeringAttemptId = answered.id;
    const gradedQuestion = requiredAt(
      answered.questions.filter((q) => q.id === questionId),
      0,
      'the graded question in the attempt',
    );
    const chosenOption = requiredAt(
      gradedQuestion.question_answers ?? [],
      0,
      'the first answer option',
    );
    publishedOptionContent = chosenOption.content;
    await submit(answering, answered, [
      {
        questionId: gradedQuestion.id,
        selectedAnswerId: chosenOption.id,
      },
    ]);

    const empty = await start(silent);
    silentAttemptId = empty.id;
    await submit(silent, empty, []);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(answering.user.id);
    await cleanupQuizAttempts(silent.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(teacher.orgId ?? '');
  });

  it('carries the answer rows of a submitted attempt', async () => {
    const rows = await results();
    const row = rows.find((r) => r.id === answeringAttemptId);
    expect(row, 'the submitted attempt is listed').toBeDefined();

    expect(row?.quiz_answers, 'the answer rows travel with the attempt').toBeInstanceOf(Array);
    expect(row?.quiz_answers).toHaveLength(1);
    const answer = row?.quiz_answers.find((a) => a.question_id === questionId);
    expect(answer, 'the answer for the graded question is embedded').toBeDefined();
    expect(answer?.teacher_points, 'a submitted answer starts ungraded').toBeNull();
    expect(row?.assignment_answer_images, 'the photo rows travel too').toBeInstanceOf(Array);
  });

  it('returns empty answer arrays for an attempt with no answers', async () => {
    const rows = await results();
    const row = rows.find((r) => r.id === silentAttemptId);
    expect(row, 'an unanswered attempt is still listed').toBeDefined();

    expect(row?.quiz_answers, 'no answers is an empty list, never a missing key').toEqual([]);
    expect(row?.assignment_answer_images).toEqual([]);
  });

  it('resolves a choice answer to the option text published with the run (#1238)', async () => {
    const row = (await results()).find((r) => r.id === answeringAttemptId);
    const answer = row?.quiz_answers.find((a) => a.question_id === questionId);
    expect(answer?.selected_option_id, 'the row carries the chosen option id').toBeTruthy();
    expect(answer?.selected_option_content, 'the card prints the option, not its id').toBe(
      publishedOptionContent,
    );

    await editLiveQuestion(questionId);
    const afterEdit = (await results()).find((r) => r.id === answeringAttemptId);
    expect(
      afterEdit?.quiz_answers.find((a) => a.question_id === questionId)?.selected_option_content,
      'a post-publish edit never rewrites what the student answered',
    ).toBe(publishedOptionContent);
  });

  it('leaves a skipped answer without an option text (#1238)', async () => {
    const service = createServiceClient();
    // The page treats a missing answer row and a row with no selection the same way; pin the row
    // case so a defaulted option can never leak into the card.
    const { error } = await service.from('student_answers').insert({
      attempt_id: silentAttemptId,
      question_id: questionId,
      selected_option_id: null,
      text_answer: null,
      is_correct: false,
      teacher_points: null,
    });
    if (error) throw new Error(error.message);

    const row = (await results()).find((r) => r.id === silentAttemptId);
    const answer = row?.quiz_answers.find((a) => a.question_id === questionId);
    expect(answer, 'the skipped answer is listed').toBeDefined();
    expect(answer?.selected_option_content, 'no selection, no option text').toBeNull();
  });

  it('shows a grade written through the per-attempt route on the next read', async () => {
    expect(await grade(answeringAttemptId, 1, 'trafne uzasadnienie')).toBe(200);

    const rows = await results();
    const answer = rows
      .find((r) => r.id === answeringAttemptId)
      ?.quiz_answers.find((a) => a.question_id === questionId);
    expect(answer?.teacher_points, 'the stored grade is what the list returns').toBe(1);
    expect(answer?.teacher_feedback).toBe('trafne uzasadnienie');
  });
});
