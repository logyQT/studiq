import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';
import { latestShippedFunction } from '#test/integration/test-utils';

// ADR-0015 phase 7, R29/R41: daily AI token accounting is one self-guarding
// statement. The burst below is the regression the old read-modify-write
// allowed: two reservations read the same total, each wrote `old + own`, and
// the ceiling was passed. A mocked `auth.uid()` proves nothing (R41), so every
// call here is a real signed-in session — `reserve_ai_tokens` derives the actor
// from the JWT inside the function.

const PASSWORD = 'ReserveTokens!';
const MIGRATION = 'supabase/migrations/20261125130000_reserve_ai_tokens.sql';

function requireLocalDatabaseUrl(): string {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) {
    throw new Error(
      "reserve-ai-tokens needs SUPABASE_DB_URL pointing at this checkout's local Supabase: the " +
        'function is installed from its migration so a mutation to that file reaches the ' +
        'database. Run the suite through `bun run env:run -- bun run test:integration`.',
    );
  }
  const { hostname } = new URL(raw);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    throw new Error('reserve-ai-tokens must run against the local stack, not a remote database');
  }
  return raw;
}

/**
 * Install the shipped body over the direct connection. A copy here could pass
 * while production ships something else, and a mutation to the migration has to
 * reach the database to turn this suite red.
 */
const SHIPPED_FUNCTION = latestShippedFunction('reserve_ai_tokens');
if (!SHIPPED_FUNCTION.includes('on conflict')) {
  throw new Error(`${MIGRATION} no longer defines the atomic upsert`);
}

async function installShippedFunction(): Promise<void> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(SHIPPED_FUNCTION);
  } finally {
    await sql.end();
  }
}

function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

describe('reserve_ai_tokens', () => {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `reserve-tokens-${tag}@dev.local`;
  const day = new Date().toISOString().slice(0, 10);

  let service: SupabaseClient<Database>;
  let session: SupabaseClient<Database>;
  let userId: string;

  async function signIn(): Promise<SupabaseClient<Database>> {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`signIn failed: ${error.message}`);
    return client;
  }

  async function storedTotal(): Promise<number> {
    const { data, error } = await service
      .from('user_daily_activity')
      .select('ai_input_tokens, ai_output_tokens')
      .eq('user_id', userId)
      .eq('date', day)
      .maybeSingle();
    if (error) throw new Error(`activity read failed: ${error.message}`);
    if (!data) return 0;
    return data.ai_input_tokens + data.ai_output_tokens;
  }

  async function clear(): Promise<void> {
    const { error } = await service
      .from('user_daily_activity')
      .delete()
      .eq('user_id', userId)
      .eq('date', day);
    if (error) throw new Error(`activity reset failed: ${error.message}`);
  }

  beforeAll(async () => {
    await installShippedFunction();
    service = createServiceClient();

    const { data: created, error: userError } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'reserve-tokens', account_type: 'student' },
    });
    if (userError) throw new Error(`createUser failed: ${userError.message}`);
    userId = created.user.id;

    session = await signIn();
  });

  afterAll(async () => {
    if (userId) {
      await service.from('user_daily_activity').delete().eq('user_id', userId);
      await service.auth.admin.deleteUser(userId).catch(() => {});
    }
  });

  it('reserves atomically under a concurrent burst: one accepted, the stored total never passes the ceiling', async () => {
    await clear();

    // Two overlapping transactions are required: the second must reach its
    // write while the first's row is still uncommitted, exactly the window the
    // old read-modify-write lost. PostgREST may serve one client's requests on
    // one connection, so the overlap is driven on two direct connections with
    // the signed-in session's own JWT claims — `auth.uid()` inside the
    // function still resolves the real user (R41), never a mocked one.
    const { data: auth } = await session.auth.getSession();
    const token = auth.session?.access_token;
    if (!token) throw new Error('the burst needs the signed-in session token');
    const claims = Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8');

    const dbA = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    const dbB = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      async function beginReservation(db: postgres.Sql): Promise<Array<{ accepted: boolean }>> {
        await db.unsafe('begin');
        await db.unsafe('set local role authenticated');
        await db`select set_config('request.jwt.claims', ${claims}, true)`;
        return db<Array<{ accepted: boolean }>>`
          select accepted from public.reserve_ai_tokens(${day}::date, 4, 4, 10)
        `;
      }

      // A inserts (8 tokens) and holds the row uncommitted.
      const first = await beginReservation(dbA);
      // B reads no row yet, then blocks on A's unique key.
      const secondPending = beginReservation(dbB);
      // Give B time to reach the insert before A commits. B is blocked at the
      // statement, so this window is deterministic, not a race.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await dbA.unsafe('commit');
      const second = await secondPending;
      await dbB.unsafe('commit');

      expect(first[0]?.accepted).toBe(true);
      expect(second[0]?.accepted).toBe(false);

      const stored = await storedTotal();
      expect(stored).toBe(8);
      expect(stored).toBeLessThanOrEqual(10);
    } finally {
      await dbA.unsafe('rollback').catch(() => {});
      await dbB.unsafe('rollback').catch(() => {});
      await dbA.end();
      await dbB.end();
    }
  });

  it('refuses a single reservation that would itself pass the ceiling', async () => {
    await clear();

    const { data, error } = await session.rpc('reserve_ai_tokens', {
      p_day: day,
      p_input_tokens: 6,
      p_output_tokens: 6,
      p_limit: 10,
    });

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ accepted: false, input_total: 0, output_total: 0 });
    expect(await storedTotal()).toBe(0);
  });

  it('treats -1 as unlimited across two reservations', async () => {
    await clear();

    const first = await session.rpc('reserve_ai_tokens', {
      p_day: day,
      p_input_tokens: 50,
      p_output_tokens: 50,
      p_limit: -1,
    });
    const second = await session.rpc('reserve_ai_tokens', {
      p_day: day,
      p_input_tokens: 50,
      p_output_tokens: 50,
      p_limit: -1,
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data?.[0]).toMatchObject({ accepted: true, input_total: 50, output_total: 50 });
    expect(second.data?.[0]).toMatchObject({
      accepted: true,
      input_total: 100,
      output_total: 100,
    });
    expect(await storedTotal()).toBe(200);
  });

  it('raises when there is no authenticated actor (the actor comes from the JWT)', async () => {
    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      // `authenticated` holds EXECUTE, but with no `request.jwt.claims` the
      // function's `auth.uid()` is null and it must raise rather than write a
      // NULL actor.
      await sql`set role authenticated`;
      await expect(
        sql`select * from public.reserve_ai_tokens(${day}::date, 1, 1, 10)`,
      ).rejects.toThrow(/requires an authenticated actor/);
    } finally {
      await sql.end();
    }
  });
});
