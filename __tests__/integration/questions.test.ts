import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { DELETE, GET, PUT } from '@/app/(backend)/api/v1/questions/[id]/route';
import { POST as createBankPost } from '@/app/(backend)/api/v1/questions/banks/route';
import { GET as GET_LIST, POST } from '@/app/(backend)/api/v1/questions/route';
import {
  before,
  createTestUser,
  type BeforeResult,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupOrganizationByName,
  cleanupQuestions,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

forEachCopy((copyId) => {
  describe(`Questions Integration [${copyId}]`, () => {
    registerMock(copyId, null);

    let educator!: BeforeResult;
    let student!: TestUserFixture;
    let manager!: TestUserFixture;
    let orgId!: string;

    beforeAll(async () => {
      // Educator creates the org via the API and becomes its admin member.
      educator = await before({ role: 'educator', org: true });
      orgId = educator.orgId!;
      student = await createTestUser({ role: 'student' });
      manager = await createTestUser({ role: 'manager' });
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
      // Keep the org's question set clean between tests.
      // Scope cleanup to THIS copy's questions only via content prefix.
      await cleanupQuestions(educator.user.id, `copy-${copyId}`);
    });

    afterAll(async () => {
      await cleanupOrganizationByName('seed-org-');
    });

    const orgCookies = () => ({ active_org_id: orgId });

    async function createBank(name: string): Promise<string> {
      mockUser(educator.user);
      const req = createNextRequest(
        'http://localhost/api/v1/questions/banks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        },
        orgCookies(),
      );
      const res = await createBankPost(req);
      const body = await res.json();
      if (res.status !== 201) throw new Error(`bank create failed: ${JSON.stringify(body)}`);
      return body.data.id as string;
    }

    async function createQuestion(
      content: string,
      opts: { type?: 'mcq' | 'true_false' } = {},
    ): Promise<{ id: string; bankId: string }> {
      const bankId = await createBank(`q-test-bank-${copyId}-${Date.now()}-${Math.random()}`);
      mockUser(educator.user);
      const prefixedContent = `copy-${copyId}-${content}`;
      const req = createNextRequest(
        'http://localhost/api/v1/questions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bankId,
            type: opts.type ?? 'mcq',
            content: prefixedContent,
            answers: [{ content: 'Answer', isCorrect: true, orderIndex: 0 }],
          }),
        },
        orgCookies(),
      );
      const res = await POST(req);
      const body = await res.json();
      if (res.status !== 201) throw new Error(`question create failed: ${JSON.stringify(body)}`);
      return { id: body.data.id as string, bankId };
    }

    describe('POST /api/v1/questions', () => {
      it('creates a question and returns 201', async () => {
        mockUser(educator.user);

        const bankReq = createNextRequest(
          'http://localhost/api/v1/questions/banks',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `q-test-Main Bank-${copyId}` }),
          },
          orgCookies(),
        );
        const bankRes = await createBankPost(bankReq);
        const bankBody = await bankRes.json();
        expect(bankRes.status).toBe(201);
        expect(bankBody.data.id).toBeDefined();

        const req = createNextRequest('http://localhost/api/v1/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bankId: bankBody.data.id,
            type: 'mcq',
            content: `copy-${copyId}-What is 2+2?`,
            answers: [
              { content: '4', isCorrect: true, orderIndex: 0 },
              { content: '5', isCorrect: false, orderIndex: 1 },
            ],
          }),
        }, orgCookies());

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.data.content).toBe(`copy-${copyId}-What is 2+2?`);
        expect(body.data.question_answers).toBeDefined();
      });

      it('returns 422 when content is empty', async () => {
        mockUser(educator.user);

        const req = createNextRequest('http://localhost/api/v1/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bankId: '00000000-0000-4000-8000-000000000099',
            type: 'mcq',
            content: '',
            answers: [{ content: 'Answer', isCorrect: true }],
          }),
        }, orgCookies());

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
      });

      it('returns 422 when answers array is empty', async () => {
        mockUser(educator.user);

        const req = createNextRequest('http://localhost/api/v1/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bankId: '00000000-0000-4000-8000-000000000099',
            type: 'mcq',
            content: 'Question',
            answers: [],
          }),
        }, orgCookies());

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest('http://localhost/api/v1/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bankId: '00000000-0000-4000-8000-000000000099',
            type: 'mcq',
            content: 'Question',
            answers: [{ content: 'Answer', isCorrect: true }],
          }),
        });

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });

      it('returns 403 when using another users bankId', async () => {
        // Bank owned by the educator (org admin) — created through the real API.
        const bankId = await createBank(`q-test-foreign-bank-${copyId}`);

        mockUser(student);

        const req = createNextRequest('http://localhost/api/v1/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'mcq',
            content: 'Question',
            bankId,
            answers: [{ content: 'Answer', isCorrect: true }],
          }),
        }, orgCookies());

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
      });

      it('returns 404 when bankId does not exist', async () => {
        mockUser(educator.user);

        const req = createNextRequest('http://localhost/api/v1/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'mcq',
            content: 'Question',
            bankId: '00000000-0000-4000-8000-000000000099',
            answers: [{ content: 'Answer', isCorrect: true }],
          }),
        }, orgCookies());

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);
      });
    });

    describe('GET /api/v1/questions', () => {
      it('returns questions list', async () => {
        mockUser(educator.user);

        const req = createNextRequest('http://localhost/api/v1/questions', undefined, orgCookies());
        const response = await GET_LIST(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(Array.isArray(body.data)).toBe(true);
      });

      it('filters by type', async () => {
        // Seed exactly one true_false question via the API (bank + question).
        await createQuestion('True or False?', { type: 'true_false' });

        mockUser(educator.user);
        const req = createNextRequest('http://localhost/api/v1/questions?type=true_false', undefined, orgCookies());
        const response = await GET_LIST(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.length).toBe(1);
        expect(body.data[0].type).toBe('true_false');
      });
    });

    describe('GET /api/v1/questions/:id', () => {
      it('returns question when found', async () => {
        const { id } = await createQuestion('Get Me');

        mockUser(educator.user);
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/questions/${id}`,
          { id },
          undefined,
          orgCookies(),
        );
        const response = await GET(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.content).toBe(`copy-${copyId}-Get Me`);
      });

      it('returns 404 when question does not exist', async () => {
        mockUser(educator.user);

        const fakeId = '00000000-0000-4000-8000-000000000099';
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/questions/${fakeId}`,
          { id: fakeId },
          undefined,
          orgCookies(),
        );
        const response = await GET(request, { params });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);
      });
    });

    describe('PUT /api/v1/questions/:id', () => {
      it('updates own question and returns 200', async () => {
        const { id } = await createQuestion('Original');

        mockUser(educator.user);
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/questions/${id}`,
          { id },
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'Updated' }),
          },
          orgCookies(),
        );
        const response = await PUT(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.content).toBe('Updated');
      });

      it('returns 403 when updating another user question', async () => {
        // Educator owns the question; manager (non-member) tries to update it.
        const { id } = await createQuestion('Teacher Question');

        mockUser(manager);
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/questions/${id}`,
          { id },
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'Hacked' }),
          },
          orgCookies(),
        );
        const response = await PUT(request, { params });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
      });
    });

    describe('DELETE /api/v1/questions/:id', () => {
      it('deletes own question and returns 200', async () => {
        const { id } = await createQuestion('To Delete');

        mockUser(educator.user);
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/questions/${id}`,
          { id },
          { method: 'DELETE' },
          orgCookies(),
        );
        const response = await DELETE(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
      });

      it('returns 403 when deleting another user question', async () => {
        const { id } = await createQuestion('Teacher Question');

        mockUser(manager);
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/questions/${id}`,
          { id },
          { method: 'DELETE' },
          orgCookies(),
        );
        const response = await DELETE(request, { params });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
      });
    });
  });
});
