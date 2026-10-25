import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import { createServiceClient, mockUser } from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { GET as paymentsGet } from '@/app/(backend)/api/v1/me/payments/route';
import { POST as webhookPost } from '@/app/(backend)/api/v1/stripe/webhook/route';

// Regression tests for #392 (STU-52): the "Historia płatności" page always said
// "Brak płatności" because nothing persisted a purchase and nothing read one.
//
// This suite drives the real webhook + read route (withAuth → controller →
// service) and then checks the RLS surface with a REAL anon-key signed-in
// client, because `mockUser()` swaps the app's client for a service-role one
// that bypasses RLS.

const PASSWORD = 'Pay392Test!';
const BASE_URL = 'http://localhost';

let buyer: TestUserFixture;
let other: TestUserFixture;
let buyerSession: SupabaseClient;
let otherSession: SupabaseClient;
let sessionId: string;

const service = createServiceClient();

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

async function completeCheckout(user: TestUserFixture, sid: string, planId = 'spark') {
  mockUser(user);
  return webhookPost(
    createNextRequest(`${BASE_URL}/api/v1/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'checkout.session.completed',
        session_id: sid,
        plan_id: planId,
        user_id: user.id,
      }),
    }),
  );
}

async function listPayments(user: TestUserFixture) {
  mockUser(user);
  const res = await paymentsGet(createNextRequest(`${BASE_URL}/api/v1/me/payments`));
  return { res, body: await res.json() };
}

describe('payment history (#392)', () => {
  beforeAll(async () => {
    buyer = await createTestUser({ role: 'student', password: PASSWORD });
    other = await createTestUser({ role: 'student', password: PASSWORD });

    // A migrated-but-not-reset database may already carry rows for these users.
    await service.from('payments').delete().in('user_id', [buyer.id, other.id]);

    buyerSession = await signIn(buyer.email);
    otherSession = await signIn(other.email);
    sessionId = `pay392-${Date.now()}`;
  });

  afterAll(async () => {
    if (buyer?.id || other?.id) {
      await service
        .from('payments')
        .delete()
        .in('user_id', [buyer?.id, other?.id].filter(Boolean) as string[]);
    }
    for (const user of [buyer, other]) {
      if (user?.id) await service.auth.admin.deleteUser(user.id).catch(() => {});
    }
  });

  it('records a completed checkout and serves it from /api/v1/me/payments', async () => {
    const webhook = await completeCheckout(buyer, sessionId);
    expect(webhook.status).toBe(200);

    const { res, body } = await listPayments(buyer);
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      planKey: 'spark',
      planName: 'StudiQ Spark',
      amount: 999,
      currency: 'PLN',
    });
    expect(typeof body.data[0].id).toBe('string');
    expect(Number.isNaN(new Date(body.data[0].paidAt).getTime())).toBe(false);
  });

  it('is idempotent for a replayed session id', async () => {
    const webhook = await completeCheckout(buyer, sessionId);
    expect(webhook.status).toBe(200);

    const { body } = await listPayments(buyer);
    expect(body.data).toHaveLength(1);
  });

  it('does not leak another user history', async () => {
    const { res, body } = await listPayments(other);
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it('rejects a webhook that targets another user and writes nothing (#227)', async () => {
    const sid = `sec227-${Date.now()}`;
    const { data: before } = await service
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', other.id)
      .single();

    mockUser(buyer);
    const res = await webhookPost(
      createNextRequest(`${BASE_URL}/api/v1/stripe/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'checkout.session.completed',
          session_id: sid,
          plan_id: 'spark',
          user_id: other.id,
        }),
      }),
    );

    expect(res.status).toBe(403);

    const { data: payments } = await service.from('payments').select('id').eq('session_id', sid);
    expect(payments).toEqual([]);

    const { data: after } = await service
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', other.id)
      .single();
    expect(after?.personal_plan_key).toBe(before?.personal_plan_key);
  });

  it('lets the owner read their rows through RLS but never write them', async () => {
    const { data: own, error: readError } = await buyerSession
      .from('payments')
      .select('id, user_id, amount');
    expect(readError).toBeNull();
    expect(own).toHaveLength(1);
    expect(own?.[0].user_id).toBe(buyer.id);

    const { data: foreign } = await otherSession.from('payments').select('id');
    expect(foreign).toEqual([]);

    const insert = await buyerSession.from('payments').insert({
      user_id: buyer.id,
      plan_key: 'spark',
      plan_name: 'Forged',
      amount: 1,
      session_id: `forged-${Date.now()}`,
    });
    expect(insert.error?.code).toBe('42501');

    const update = await buyerSession.from('payments').update({ amount: 1 }).eq('id', own?.[0].id);
    expect(update.error?.code).toBe('42501');

    const remove = await buyerSession.from('payments').delete().eq('id', own?.[0].id);
    expect(remove.error?.code).toBe('42501');
  });
});
