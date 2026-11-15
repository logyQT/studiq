import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@studiq/server/types/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson, json } from '#test/helpers/json';
import { FIXTURE_MODEL_ANSWER, fixtureExplanation } from '#test/helpers/question-text';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import { cleanupOrganizationDeep, createServiceClient, mockUser } from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { PUT as updateQuestion } from '@/app/(backend)/api/v1/questions/[id]/route';
import { POST as importQuestions } from '@/app/(backend)/api/v1/questions/banks/[id]/import/route';
import { POST as createQuestion } from '@/app/(backend)/api/v1/questions/route';

// #1173 (R16/R17): the explanation is required for a choice item and has to teach, an open item
// needs a model answer, and the answer artefact never becomes a client-readable column. The seam
// is the real route → controller → service stack against local Supabase, plus one real
// PostgREST session for the database boundary.

interface CreatedQuestion {
  id: string;
  explanation: string | null;
  model_answer?: string | null;
  type: string;
}

interface IssueEnvelope {
  success: boolean;
  error?: string;
  issues?: { properties?: Record<string, { errors?: string[] }> };
}

const TEACHING =
  'Wisła jest najdłuższą rzeką w Polsce i uchodzi do Bałtyku, dlatego wyznacza oś hydrograficzną kraju, a pozostałe rzeki są od niej krótsze.';

function fieldErrors(body: IssueEnvelope, field: string): string[] {
  return body.issues?.properties?.[field]?.errors ?? [];
}

describe('Question authoring rules (#1173)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: TestUserFixture;
  let bankId!: string;

  const cookie = () => ({ active_org_id: teacher.orgId ?? '' });

  function mcq(over: Record<string, unknown> = {}) {
    return {
      bankId,
      type: 'mcq',
      content: `rules-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      answers: [
        { content: 'Wisła', isCorrect: true, orderIndex: 0 },
        { content: 'Odra', isCorrect: false, orderIndex: 1 },
      ],
      ...over,
    };
  }

  async function create(body: unknown): Promise<Response> {
    mockUser(teacher.user);
    return createQuestion(
      createNextRequest(
        'http://localhost/api/v1/questions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        cookie(),
      ),
    );
  }

  async function update(id: string, body: unknown): Promise<Response> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${id}`,
      { id },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      cookie(),
    );
    return updateQuestion(request, { params });
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, questions: 1 });
    student = await createTestUser({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');

    const questionId = teacher.created.questions[0];
    if (!questionId) throw new Error('the teacher fixture has no question');
    const { data } = await service
      .from('questions')
      .select('bank_id')
      .eq('id', questionId)
      .single();
    bankId = asJson<{ bank_id: string }>(data).bank_id;
  });

  afterAll(async () => {
    if (teacher.orgId) await cleanupOrganizationDeep(teacher.orgId);
    await service.auth.admin.deleteUser(student.id);
  });

  it('refuses a choice item without an explanation, naming the field', async () => {
    const response = await create(mcq());
    const body = await json<IssueEnvelope>(response);

    expect(response.status, JSON.stringify(body)).toBe(422);
    expect(fieldErrors(body, 'explanation')).toEqual(['VALIDATION_EXPLANATION_REQUIRED']);
  });

  it('refuses an explanation below the teaching floor', async () => {
    const response = await create(mcq({ explanation: 'Wisła jest najdłuższa.' }));
    const body = await json<IssueEnvelope>(response);

    expect(response.status).toBe(422);
    expect(fieldErrors(body, 'explanation')).toEqual(['VALIDATION_EXPLANATION_TOO_SHORT']);
  });

  it('refuses an explanation that points at an option by letter, ordinal or number', async () => {
    for (const explanation of [
      'Odpowiedź B jest poprawna, ponieważ Wisła jest najdłuższą rzeką w Polsce i uchodzi do Bałtyku.',
      'Prawidłowa jest druga odpowiedź, bo Wisła jest dłuższa od Odry i uchodzi do Bałtyku, zbierając wodę z połowy kraju.',
      'Poprawna opcja 2 jest właściwa, ponieważ Wisła jest najdłuższą rzeką w Polsce i uchodzi do Bałtyku.',
    ]) {
      const response = await create(mcq({ explanation }));
      const body = await json<IssueEnvelope>(response);

      expect(response.status, explanation).toBe(422);
      expect(fieldErrors(body, 'explanation'), explanation).toEqual([
        'VALIDATION_EXPLANATION_NAMES_OPTION',
      ]);
    }
  });

  it('refuses an explanation that quotes a long option verbatim', async () => {
    const response = await create(
      mcq({
        explanation:
          'Warszawa jest stolicą Polski od 1596 roku, więc wybór wynika z historii kraju i przeniesienia stolicy.',
        answers: [
          { content: 'Warszawa jest stolicą Polski', isCorrect: true, orderIndex: 0 },
          { content: 'Kraków był stolicą do 1596 roku', isCorrect: false, orderIndex: 1 },
        ],
      }),
    );
    const body = await json<IssueEnvelope>(response);

    expect(response.status).toBe(422);
    expect(fieldErrors(body, 'explanation')).toEqual(['VALIDATION_EXPLANATION_QUOTES_OPTION']);
  });

  it('accepts a teaching-length explanation, up to the 2 040-character cap', async () => {
    const accepted = await create(mcq({ explanation: TEACHING }));
    expect(accepted.status, await accepted.clone().text()).toBe(201);

    const capped = await create(mcq({ explanation: 'a'.repeat(2040) }));
    expect(capped.status, await capped.clone().text()).toBe(201);

    const tooLong = await create(mcq({ explanation: 'a'.repeat(2041) }));
    const body = await json<IssueEnvelope>(tooLong);
    expect(tooLong.status).toBe(422);
    expect(fieldErrors(body, 'explanation')).toEqual(['VALIDATION_TOO_LONG']);
  });

  it('requires a model answer for an open item and returns it to the author', async () => {
    const missing = await create({
      bankId,
      type: 'open',
      content: `rules-open-${Date.now()}`,
      answers: [],
    });
    const missingBody = await json<IssueEnvelope>(missing);
    expect(missing.status).toBe(422);
    expect(fieldErrors(missingBody, 'modelAnswer')).toEqual(['VALIDATION_MODEL_ANSWER_REQUIRED']);

    const created = await create({
      bankId,
      type: 'open',
      content: `rules-open-${Date.now()}-ok`,
      modelAnswer: FIXTURE_MODEL_ANSWER,
      answers: [],
    });
    const body = await json<{ data: CreatedQuestion }>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    expect(body.data.model_answer).toBe(FIXTURE_MODEL_ANSWER);
  });

  it('judges an update on the merged item, not on the patch', async () => {
    const created = await create(mcq({ explanation: TEACHING }));
    const question = (await json<{ data: CreatedQuestion }>(created)).data;

    // A content-only patch keeps the stored (valid) explanation: nothing to fix.
    const renamed = await update(question.id, { content: `${question.id}-renamed` });
    expect(renamed.status, await renamed.clone().text()).toBe(200);

    // The same patch with a label-sized explanation is refused, on the explanation field.
    const short = await update(question.id, { explanation: 'Zbyt krótko.' });
    const body = await json<IssueEnvelope>(short);
    expect(short.status).toBe(422);
    expect(fieldErrors(body, 'explanation')).toEqual(['VALIDATION_EXPLANATION_TOO_SHORT']);
  });

  it('enforces the same rule on import and carries the model answer', async () => {
    const importBody = (questions: unknown[]) => {
      mockUser(teacher.user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/questions/banks/${bankId}/import`,
        { id: bankId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questions }),
        },
        cookie(),
      );
      return importQuestions(request, { params });
    };

    const refused = await importBody([
      {
        type: 'mcq',
        content: 'Imported without an explanation',
        answers: [
          { content: 'a', isCorrect: true },
          { content: 'b', isCorrect: false },
        ],
      },
    ]);
    const refusedBody = await json<IssueEnvelope>(refused);
    expect(refused.status, JSON.stringify(refusedBody)).toBe(422);
    expect(refusedBody.issues?.properties?.questions).toBeDefined();

    const accepted = await importBody([
      {
        type: 'open',
        content: `imported-open-${Date.now()}`,
        modelAnswer: FIXTURE_MODEL_ANSWER,
        answers: [],
      },
      {
        type: 'mcq',
        content: `imported-mcq-${Date.now()}`,
        explanation: fixtureExplanation('import'),
        answers: [
          { content: 'a', isCorrect: true },
          { content: 'b', isCorrect: false },
        ],
      },
    ]);
    expect(accepted.status, await accepted.clone().text()).toBe(201);

    const { data } = await service
      .from('questions')
      .select('type, model_answer, explanation')
      .eq('bank_id', bankId)
      .eq('type', 'open')
      .like('content', 'imported-open-%')
      .single();
    const row = asJson<{ model_answer: string | null; explanation: string | null }>(data);
    expect(row.model_answer).toBe(FIXTURE_MODEL_ANSWER);
  });

  it('keeps the model answer off the client-readable surface', async () => {
    // A real PostgREST session with the anon key — the exact path a browser uses.
    const client: SupabaseClient<Database> = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signIn = await client.auth.signInWithPassword({
      email: student.email,
      password: student.password,
    });
    expect(signIn.error).toBeNull();

    const keyed = await client.from('questions').select('id, model_answer').limit(1);
    expect(keyed.error?.code, 'model_answer must not be selectable').toBe('42501');

    const reader = await client.from('questions').select('id, content, explanation').limit(1);
    expect(reader.error).toBeNull();
  });
});
