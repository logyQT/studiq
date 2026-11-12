import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '#test/helpers/json';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupFlashcardTopics,
  cleanupQuestions,
  cleanupQuizAttempts,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, requiredAt } from '#test/integration/test-utils';
import { POST } from '@/app/(backend)/api/v1/quiz/new/route';
import { POST as createTopicPost } from '@/app/(backend)/api/v1/topics/route';

const suiteId = crypto.randomUUID().slice(0, 8);

interface QuizQuestion {
  id: string;
  question_answers: Array<Record<string, unknown>>;
}

/** `/api/v1/quiz/new` success body — only the fields these tests read. */
interface QuizBody {
  success: boolean;
  data: { questions: QuizQuestion[] };
}

/** Error body: every failure case only asserts `success`. */
interface ErrorBody {
  success: boolean;
}

describe(`Quizzes Integration`, () => {
  let student!: BeforeResult;

  beforeAll(async () => {
    // Fresh student + 5 personal mcq questions seeded through the real
    // question API (bank created implicitly via the question-banks API).
    student = await before({ role: 'student', questions: 5 });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    useRealSupabase();
    await cleanupQuizAttempts(student.user.id);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupFlashcardTopics(student.user.id, 'seed-quiz-topic-');
    await cleanupQuestions(student.user.id, 'seed-question-');
  });

  describe('POST /api/v1/quizzes', () => {
    it('generates a quiz and returns 201', async () => {
      mockUser(student.user);

      const req = createNextRequest('http://localhost/api/v1/quiz/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: ['mcq'],
          questionCount: 3,
        }),
      });

      const response = await POST(req);
      const body = await json<QuizBody>(response);

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.questions).toBeDefined();
      expect(body.data.questions.length).toBeLessThanOrEqual(3);

      // #331: the generated quiz must not carry the answer key.
      const question = requiredAt(body.data.questions, 0, 'generated question');
      expect(question).not.toHaveProperty('explanation');
      expect(question).not.toHaveProperty('search_vector');
      expect(question.question_answers.length).toBeGreaterThan(0);
      for (const option of question.question_answers) {
        expect(option).not.toHaveProperty('is_correct');
      }
    });

    it('generates a quiz without optional fields', async () => {
      mockUser(student.user);

      const req = createNextRequest('http://localhost/api/v1/quiz/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: ['mcq'],
          questionCount: 2,
        }),
      });

      const response = await POST(req);
      const body = await json<QuizBody>(response);

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('scopes the generated quiz to the selected topic', async () => {
      mockUser(student.user);

      const topicName = `seed-quiz-topic-${suiteId}`;
      const topicRes = await createTopicPost(
        createNextRequest('http://localhost/api/v1/topics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: topicName }),
        }),
      );
      const topicBody = await json<{ data: { id: string } }>(topicRes);
      expect(topicRes.status).toBe(201);
      const topicId = topicBody.data.id;

      // Tag exactly one of the five seeded questions with the new topic. The
      // question PUT route scopes its update to `organization_id = activeOrgId`,
      // which never matches a personal (org-less) question, so the assignment is
      // made through the service-role client like the other integration fixtures.
      const taggedQuestionId = requiredAt(student.created.questions, 0, 'seeded question');
      const { error: tagError } = await createServiceClient()
        .from('question_topic_assignments')
        .insert({ question_id: taggedQuestionId, topic_id: topicId });
      expect(tagError).toBeNull();

      const req = createNextRequest('http://localhost/api/v1/quiz/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicIds: [topicId],
          questionTypes: ['mcq'],
          questionCount: 5,
        }),
      });

      const response = await POST(req);
      const body = await json<QuizBody>(response);

      expect(response.status).toBe(201);
      expect(body.data.questions.map((question) => question.id)).toEqual([taggedQuestionId]);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/quiz/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: ['mcq'],
          questionCount: 3,
        }),
      });

      const response = await POST(req);
      const body = await json<ErrorBody>(response);

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 422 when questionTypes is empty', async () => {
      mockUser(student.user);

      const req = createNextRequest('http://localhost/api/v1/quiz/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: [],
          questionCount: 3,
        }),
      });

      const response = await POST(req);
      const body = await json<ErrorBody>(response);

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 404 when no matching questions exist', async () => {
      mockUser(student.user);

      const req = createNextRequest('http://localhost/api/v1/quiz/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: ['open'],
          questionCount: 3,
        }),
      });

      const response = await POST(req);
      const body = await json<ErrorBody>(response);

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });
});
