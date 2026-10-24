import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupQuestions,
  cleanupQuizAttempts,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { POST as createBankPost } from '@/app/(backend)/api/v1/questions/banks/route';
import { POST as createQuizPost } from '@/app/(backend)/api/v1/quiz/new/route';

// Issue #183 (LIM-02): `max_question_banks` and `max_quiz_attempts_per_day` are
// advertised on the pricing/billing pages but were never enforced server-side.
// These tests create a dedicated plan per copy (so the shared seeded plans are
// never mutated) and exercise the real routes end-to-end.
const BANK_LIMIT = 2;
const QUIZ_LIMIT = 1;

interface ApiResponse {
  status: number;
  body: { success?: boolean; data?: unknown; error?: string };
}

async function postBank(name: string): Promise<ApiResponse> {
  const req = createNextRequest('http://localhost/api/v1/questions/banks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const response = await createBankPost(req);
  return { status: response.status, body: await response.json() };
}

async function postQuiz(): Promise<ApiResponse> {
  const req = createNextRequest('http://localhost/api/v1/quiz/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionTypes: ['mcq'], questionCount: 2 }),
  });
  const response = await createQuizPost(req);
  return { status: response.status, body: await response.json() };
}

forEachCopy((copyId) => {
  describe(`Plan limit enforcement [${copyId}]`, () => {
    registerMock(copyId, null);

    let service!: SupabaseClient;
    let planKey!: string;
    let bankStudent!: BeforeResult;
    let quizStudent!: BeforeResult;
    let bankStudentOriginalPlan!: string;
    let quizStudentOriginalPlan!: string;

    async function assignPlan(userId: string, key: string) {
      const { error } = await service
        .from('profiles')
        .update({ personal_plan_key: key })
        .eq('id', userId);
      if (error) throw new Error(`[limits] profile plan update failed: ${error.message}`);
    }

    async function personalPlan(userId: string): Promise<string> {
      const { data, error } = await service
        .from('profiles')
        .select('personal_plan_key')
        .eq('id', userId)
        .single();
      if (error || !data?.personal_plan_key) {
        throw new Error(`[limits] profile plan lookup failed: ${error?.message}`);
      }
      return data.personal_plan_key;
    }

    async function countBanks(userId: string): Promise<number> {
      const { count } = await service
        .from('question_banks')
        .select('*', { count: 'exact', head: true })
        .eq('created_by', userId);
      return count ?? 0;
    }

    async function countPracticeAttempts(userId: string): Promise<number> {
      const { count } = await service
        .from('quiz_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('assignment_id', null);
      return count ?? 0;
    }

    beforeAll(async () => {
      service = createServiceClient();
      planKey = `test-limits-${copyId}-${Date.now().toString(36)}`;

      // One student for the bank quota (starts with no banks) and one for the
      // quiz quota (questions must be seeded while still on the default plan).
      bankStudent = await before({ role: 'student' });
      quizStudent = await before({ role: 'student', questions: 5 });

      bankStudentOriginalPlan = await personalPlan(bankStudent.user.id);
      quizStudentOriginalPlan = await personalPlan(quizStudent.user.id);

      const { error: planError } = await service.from('subscription_plans').insert({
        key: planKey,
        name: `Test limits ${copyId}`,
        price_monthly: 0,
        currency: 'PLN',
        sort_order: 999,
        for_account_type: 'student',
        is_active: false,
      });
      if (planError) throw new Error(`[limits] plan create failed: ${planError.message}`);

      const { error: limitsError } = await service.from('plan_limits').insert([
        { plan_key: planKey, limit_key: 'max_question_banks', limit_value: BANK_LIMIT },
        { plan_key: planKey, limit_key: 'max_quiz_attempts_per_day', limit_value: QUIZ_LIMIT },
      ]);
      if (limitsError)
        throw new Error(`[limits] plan limits create failed: ${limitsError.message}`);
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
      await assignPlan(bankStudent.user.id, planKey);
      await assignPlan(quizStudent.user.id, planKey);
      await service.from('question_banks').delete().eq('created_by', bankStudent.user.id);
      await cleanupQuizAttempts(quizStudent.user.id);
    });

    afterAll(async () => {
      await service.from('question_banks').delete().eq('created_by', bankStudent.user.id);
      await cleanupQuizAttempts(quizStudent.user.id);
      await cleanupQuestions(quizStudent.user.id, 'seed-question-');
      // FKs require the profiles to leave the plan before the plan row is deleted.
      await assignPlan(bankStudent.user.id, bankStudentOriginalPlan);
      await assignPlan(quizStudent.user.id, quizStudentOriginalPlan);
      await service.from('plan_limits').delete().eq('plan_key', planKey);
      await service.from('subscription_plans').delete().eq('key', planKey);
    });

    describe('max_question_banks', () => {
      it('returns 429 USAGE_LIMIT_EXCEEDED on the (limit + 1)-th bank', async () => {
        mockUser(bankStudent.user);

        const first = await postBank(`test-bank-a-${copyId}`);
        const second = await postBank(`test-bank-b-${copyId}`);
        const third = await postBank(`test-bank-c-${copyId}`);

        expect([first.status, second.status, third.status]).toEqual([201, 201, 429]);
        expect(third.body.success).toBe(false);
        expect(third.body.error).toBe('USAGE_LIMIT_EXCEEDED');
        expect(await countBanks(bankStudent.user.id)).toBe(BANK_LIMIT);
      });

      it('frees a slot when a bank is deleted', async () => {
        mockUser(bankStudent.user);

        expect((await postBank(`test-bank-a-${copyId}`)).status).toBe(201);
        expect((await postBank(`test-bank-b-${copyId}`)).status).toBe(201);
        expect((await postBank(`test-bank-c-${copyId}`)).status).toBe(429);

        const { data: banks } = await service
          .from('question_banks')
          .select('id')
          .eq('created_by', bankStudent.user.id);
        expect(banks).toHaveLength(BANK_LIMIT);
        await service.from('question_banks').delete().eq('id', banks![0].id);

        expect((await postBank(`test-bank-c-${copyId}`)).status).toBe(201);
        expect(await countBanks(bankStudent.user.id)).toBe(BANK_LIMIT);
      });
    });

    describe('max_quiz_attempts_per_day', () => {
      it('returns 429 USAGE_LIMIT_EXCEEDED on the (limit + 1)-th practice attempt today', async () => {
        mockUser(quizStudent.user);

        const first = await postQuiz();
        const second = await postQuiz();

        expect(first.status).toBe(201);
        expect(second.status).toBe(429);
        expect(second.body.success).toBe(false);
        expect(second.body.error).toBe('USAGE_LIMIT_EXCEEDED');
        expect(await countPracticeAttempts(quizStudent.user.id)).toBe(QUIZ_LIMIT);
      });

      it('does not consume an attempt when the request fails validation', async () => {
        mockUser(quizStudent.user);

        const req = createNextRequest('http://localhost/api/v1/quiz/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionTypes: [], questionCount: 2 }),
        });
        expect((await createQuizPost(req)).status).toBe(422);

        expect(await countPracticeAttempts(quizStudent.user.id)).toBe(0);
        expect((await postQuiz()).status).toBe(201);
      });
    });
  });
});
