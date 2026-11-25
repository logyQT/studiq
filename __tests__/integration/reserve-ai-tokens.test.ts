import { readFileSync } from 'node:fs';
import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';
import { latestShippedFunction } from '#test/integration/test-utils';

// ADR-0015 phase 7, R29/R41: daily AI token accounting is one atomic statement.
// The burst below is the regression the old read-modify-write allowed: two
// reservations read the same total, each wrote `old + own`, and one increment
// was lost. A mocked `auth.uid()` proves nothing (R41), so every call here is a
// real signed-in session — `reserve_ai_tokens` derives the actor from the JWT
// inside the function.
//
// The write always records, including past the ceiling (see the migration): the
// pre-stream `getUsage` gate is the enforcement, and it only trips on the next
// request if the stored total is truthful. `accepted` is informational.

const PASSWORD = 'ReserveTokens!';
const MIGRATION = 'supabase/migrations/20261125130000_reserve_ai_tokens.sql';
const MIGRATION_SOURCE = readFileSync(MIGRATION, 'utf8');

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

/**
 * The migration's own DELETE revoke, replayed on the running stack (it is
 * idempotent). A local stack created before this line landed still carries the
 * blanket grant, and the coordinator owns the reset; taking the statement from
 * the migration keeps a single source of truth, so deleting it there fails here.
 */
function shippedDeleteRevoke(): string {
  const statement = MIGRATION_SOURCE.split('\n')
    .map((line) => line.trim())
    .find((line) =>
      /^revoke delete on public\.user_daily_activity from authenticated;$/i.test(line),
    );
  if (!statement) {
    throw new Error(`${MIGRATION} no longer revokes DELETE on user_daily_activity`);
  }
  return statement;
}

async function installShippedRevokes(): Promise<void> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(SHIPPED_FUNCTION);
    await sql.unsafe(shippedDeleteRevoke());
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
  let claims: string;

  async function signIn(): Promise<SupabaseClient<Database>> {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`signIn failed: ${error.message}`);
    return client;
  }

  /** The signed-in session's JWT claims, for a direct connection that still has a real actor. */
  async function sessionClaims(): Promise<string> {
    const { data } = await session.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('this case needs the signed-in session token');
    return Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8');
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
    await installShippedRevokes();
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
    claims = await sessionClaims();
  });

  afterAll(async () => {
    if (userId) {
      await service.from('user_daily_activity').delete().eq('user_id', userId);
      await service.auth.admin.deleteUser(userId).catch(() => {});
    }
  });

  it('records both increments under a concurrent burst: no lost update, exactly one reports the ceiling', async () => {
    await clear();

    // Two overlapping transactions are required: the second must reach its
    // write while the first's row is still uncommitted, exactly the window the
    // old read-modify-write lost. PostgREST may serve one client's requests on
    // one connection, so the overlap is driven on two direct connections with
    // the signed-in session's own JWT claims — `auth.uid()` inside the
    // function still resolves the real user (R41), never a mocked one.
    const dbA = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    const dbB = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    const dbWatch = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      const pidRows = await dbB<Array<{ pid: number }>>`select pg_backend_pid() as pid`;
      const secondPid = pidRows[0]?.pid;
      if (secondPid === undefined) throw new Error('dbB has no backend pid');

      async function beginReservation(
        db: postgres.Sql,
      ): Promise<Array<{ accepted: boolean; input_total: number; output_total: number }>> {
        await db.unsafe('begin');
        await db.unsafe('set local role authenticated');
        await db`select set_config('request.jwt.claims', ${claims}, true)`;
        return db<Array<{ accepted: boolean; input_total: number; output_total: number }>>`
          select accepted, input_total, output_total
          from public.reserve_ai_tokens(${day}::date, 4, 4, 10)
        `;
      }

      // A inserts (8 tokens) and holds the row uncommitted.
      const first = await beginReservation(dbA);
      // B reads no row, then blocks on A's unique key.
      const secondPending = beginReservation(dbB);

      // Wait until B is actually waiting on the lock, observed from a third,
      // uninvolved connection (a pure SELECT). A fixed sleep would be a guess:
      // too short and A commits before B reaches the row, so the burst proves
      // nothing. Bounded so a broken wait can never hang the suite.
      const deadline = Date.now() + 10_000;
      for (;;) {
        const waiterRows = await dbWatch<Array<{ waitEventType: string | null }>>`
          select wait_event_type as "waitEventType"
          from pg_stat_activity
          where pid = ${secondPid}
        `;
        if (waiterRows[0]?.waitEventType === 'Lock') break;
        if (Date.now() > deadline) {
          throw new Error(`backend ${secondPid} never blocked on the activity row`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      await dbA.unsafe('commit');
      const second = await secondPending;
      await dbB.unsafe('commit');

      // Both increments are stored (8 + 8); neither clobbered the other.
      expect(await storedTotal()).toBe(16);

      // Each call returned the totals it actually wrote: the first saw only its
      // own row, the second the committed 8 plus its own 8.
      expect(first[0]).toMatchObject({ accepted: true, input_total: 4, output_total: 4 });
      expect(second[0]).toMatchObject({ accepted: false, input_total: 8, output_total: 8 });
    } finally {
      await dbA.unsafe('rollback').catch(() => {});
      await dbB.unsafe('rollback').catch(() => {});
      await dbA.end();
      await dbB.end();
      await dbWatch.end();
    }
  });

  it('records a single reservation past the ceiling and reports it', async () => {
    await clear();

    const { data, error } = await session.rpc('reserve_ai_tokens', {
      p_day: day,
      p_input_tokens: 6,
      p_output_tokens: 6,
      p_limit: 10,
    });

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ accepted: false, input_total: 6, output_total: 6 });
    expect(await storedTotal()).toBe(12);
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

  it('never subtracts: negative counts leave the stored total unchanged', async () => {
    await clear();

    const seeded = await session.rpc('reserve_ai_tokens', {
      p_day: day,
      p_input_tokens: 5,
      p_output_tokens: 5,
      p_limit: -1,
    });
    expect(seeded.error).toBeNull();
    expect(await storedTotal()).toBe(10);

    // The reported attack: a signed-in caller posts negative counts with the
    // unlimited limit, which used to decrement its own counter through the RPC.
    const attack = await session.rpc('reserve_ai_tokens', {
      p_day: day,
      p_input_tokens: -1_000_000,
      p_output_tokens: -1_000_000,
      p_limit: -1,
    });

    expect(attack.error).toBeNull();
    expect(attack.data?.[0]).toMatchObject({ input_total: 5, output_total: 5 });
    expect(await storedTotal()).toBe(10);
  });

  it('refuses a client-side DELETE of the activity row (the counter is RPC-metered)', async () => {
    await clear();
    const { error: reserveError } = await session.rpc('reserve_ai_tokens', {
      p_day: day,
      p_input_tokens: 3,
      p_output_tokens: 4,
      p_limit: -1,
    });
    expect(reserveError).toBeNull();
    expect(await storedTotal()).toBe(7);

    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      // Control: the same connection really is `authenticated` with this
      // user's claims, so the refusal below is the DELETE grant and not a
      // missing actor.
      await sql.unsafe('begin');
      await sql.unsafe('set local role authenticated');
      await sql`select set_config('request.jwt.claims', ${claims}, true)`;

      const privilegeRows = await sql<Array<{ deletable: boolean }>>`
        select has_table_privilege('authenticated', 'public.user_daily_activity', 'DELETE')
               as deletable`;
      expect(privilegeRows[0]?.deletable).toBe(false);

      // Before the DELETE attempt: a failed statement aborts the transaction,
      // and this control proves the connection is not being refused for lack
      // of an actor.
      const actorRows = await sql<Array<{ uid: string | null }>>`select auth.uid()::text as uid`;
      expect(actorRows[0]?.uid).toBe(userId);

      await expect(
        sql`delete from public.user_daily_activity where user_id = ${userId}::uuid`,
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await sql.unsafe('rollback').catch(() => {});
      await sql.end();
    }

    expect(await storedTotal()).toBe(7);
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
