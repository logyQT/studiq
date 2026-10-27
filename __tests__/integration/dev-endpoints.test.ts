import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupFlashcardDecks,
  cleanupFlashcardPractice,
  cleanupFlashcardReviewState,
  cleanupFlashcards,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { POST as studySimulatePost } from '@/app/(backend)/api/v1/dev/study-simulate/route';
import { GET as tracesGet } from '@/app/(backend)/api/v1/dev/traces/route';

const suiteId = crypto.randomUUID().slice(0, 8);

describe(`Dev endpoints Integration`, () => {
  let student!: BeforeResult;

  beforeAll(async () => {
    student = await before({ role: 'student', decks: 1, flashcards: 2 });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
    // The routes are dev-only; the production-build QA slot cannot exercise
    // them, so the gate is stubbed here (#189).
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (student) {
      await cleanupFlashcardPractice(student.user.id);
      await cleanupFlashcardReviewState(student.user.id);
      await cleanupFlashcards(student.user.id);
      await cleanupFlashcardDecks(student.user.id);
    }
  });

  it('requires a session on GET /dev/traces (#189)', async () => {
    mockUser(null);

    const res = await tracesGet(createNextRequest('http://localhost/api/v1/dev/traces'));

    expect(res.status).toBe(401);
  });

  it('serves GET /dev/traces to a signed-in caller (#189)', async () => {
    mockUser(student.user);

    const res = await tracesGet(createNextRequest('http://localhost/api/v1/dev/traces'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('events');
  });

  it("practises the user's own cards on POST /dev/study-simulate (#189)", async () => {
    mockUser(student.user);

    const res = await studySimulatePost(
      createNextRequest('http://localhost/api/v1/dev/study-simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: student.email }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    // The stale `profiles.university_id` query answered 404 for every
    // address, so a 200 with generated practice data is the regression proof.
    expect(body.cards).toBeGreaterThanOrEqual(1);
    expect(body.updated).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 for an unknown address (#189)', async () => {
    mockUser(student.user);

    const res = await studySimulatePost(
      createNextRequest('http://localhost/api/v1/dev/study-simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `nobody-${suiteId}-${Date.now()}@example.com` }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it('stays unavailable outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockUser(student.user);

    const traces = await tracesGet(createNextRequest('http://localhost/api/v1/dev/traces'));
    const simulate = await studySimulatePost(
      createNextRequest('http://localhost/api/v1/dev/study-simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: student.email }),
      }),
    );

    expect(traces.status).toBe(403);
    expect(simulate.status).toBe(404);
  });
});
