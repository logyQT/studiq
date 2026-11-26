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
// #1482 closes the phase-7 residual: the stats triggers are definer functions
// and every write grant on the activity table is revoked.
const ACTIVITY_MIGRATION = 'supabase/migrations/20261126120000_daily_activity_definer_only.sql';
const ACTIVITY_MIGRATION_SOURCE = readFileSync(ACTIVITY_MIGRATION, 'utf8');

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

/**
 * The #1482 revokes, replayed from the migration so a mutation to that file
 * reaches the running stack. The privilege case below asserts the resulting
 * grants, so removing INSERT/UPDATE from this file leaves the restored grant
 * visible to that assertion.
 */
function shippedActivityRevokes(): string[] {
  return ACTIVITY_MIGRATION_SOURCE.split('\n')
    .map((line) => line.trim())
    .filter((line) => /^revoke\b.*\bon public\.user_daily_activity\b/i.test(line));
}

async function installShippedRevokes(): Promise<void> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(SHIPPED_FUNCTION);
    // The review trigger runs as the caller when it is not definer, so the
    // revoke below is only safe with the shipped body installed.
    await sql.unsafe(latestShippedFunction('increment_reviews'));
    await sql.unsafe(shippedDeleteRevoke());
  } finally {
    await sql.end();
  }
}

/**
 * Recreate the pre-#1482 write grant, then replay the migration's revokes. A
 * stack that already applied the migration has them revoked, so the grant keeps
 * this case independent of stack age and gives a mutation reach: remove
 * INSERT/UPDATE from the file and the restored grant survives into the
 * assertions below.
 */
async function restoreThenRevokeActivityWrites(): Promise<void> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe('grant insert, update on public.user_daily_activity to authenticated');
    for (const statement of shippedActivityRevokes()) {
      await sql.unsafe(statement);
    }
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

  /** The day's review counters, read with the service role so RLS cannot hide them. */
  async function storedReviewCounters(): Promise<{
    reviews_count: number;
    reviews_correct: number;
  } | null> {
    const { data, error } = await service
      .from('user_daily_activity')
      .select('reviews_count, reviews_correct')
      .eq('user_id', userId)
      .eq('date', day)
      .maybeSingle();
    if (error) throw new Error(`activity read failed: ${error.message}`);
    return data ?? null;
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
      await service.from('flashcard_practice').delete().eq('user_id', userId);
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

  // #1482: the daily-stats triggers are definer functions, so the write grants
  // that used to be their permission are gone. These cases replay the shipped
  // bodies and revokes on the running stack, then prove both sides: a real
  // session cannot write the row, and the triggers still book.

  it('installs both stats triggers as definer functions that pin an empty search_path', async () => {
    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      const rows = await sql<
        Array<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>
      >`
        select p.proname, p.prosecdef, p.proconfig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('increment_reviews', 'increment_quizzes')
        order by p.proname
      `;

      expect(rows.map((row) => row.proname)).toEqual(['increment_quizzes', 'increment_reviews']);
      for (const row of rows) {
        expect(row.prosecdef, `${row.proname} must be security definer`).toBe(true);
        expect(row.proconfig, `${row.proname} must pin an empty search_path`).toContain(
          'search_path=""',
        );
      }
    } finally {
      await sql.end();
    }
  });

  it('refuses direct PostgREST writes to the activity row and keeps the read', async () => {
    await restoreThenRevokeActivityWrites();
    await clear();
    const { error: reserveError } = await session.rpc('reserve_ai_tokens', {
      p_day: day,
      p_input_tokens: 3,
      p_output_tokens: 4,
      p_limit: -1,
    });
    expect(reserveError).toBeNull();
    expect(await storedTotal()).toBe(7);

    // The reported attack: a signed-in user writes the day's row directly and
    // zeroes the meter without touching the RPC or the pre-stream gate. R41: the
    // requests carry a real access token, so this is the caller's own row under
    // the real grants, not a mocked `auth.uid()`.
    const updated = await session
      .from('user_daily_activity')
      .update({ ai_input_tokens: 0, ai_output_tokens: 0 })
      .eq('user_id', userId)
      .eq('date', day);
    expect(updated.error?.code).toBe('42501');

    const inserted = await session
      .from('user_daily_activity')
      .insert({ user_id: userId, date: day, ai_input_tokens: 0, ai_output_tokens: 0 });
    expect(inserted.error?.code).toBe('42501');

    // An upsert needs INSERT and UPDATE; both are refused, so the conflict path
    // cannot become a write either.
    const upserted = await session
      .from('user_daily_activity')
      .upsert({ user_id: userId, date: day, ai_input_tokens: 0, ai_output_tokens: 0 });
    expect(upserted.error?.code).toBe('42501');

    // A refused write is not a silent success: the stored meter did not move.
    expect(await storedTotal()).toBe(7);

    // The stats surfaces read this table on every page; the read must survive.
    const { data, error } = await session
      .from('user_daily_activity')
      .select('ai_input_tokens, ai_output_tokens')
      .eq('user_id', userId)
      .eq('date', day)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toMatchObject({ ai_input_tokens: 3, ai_output_tokens: 4 });

    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      const privilegeRows = await sql<
        Array<{
          insertable: boolean;
          updatable: boolean;
          deletable: boolean;
          selectable: boolean;
        }>
      >`
        select has_table_privilege('authenticated', 'public.user_daily_activity', 'INSERT')
                 as insertable,
               has_table_privilege('authenticated', 'public.user_daily_activity', 'UPDATE')
                 as updatable,
               has_table_privilege('authenticated', 'public.user_daily_activity', 'DELETE')
                 as deletable,
               has_table_privilege('authenticated', 'public.user_daily_activity', 'SELECT')
                 as selectable
      `;
      expect(privilegeRows[0]).toEqual({
        insertable: false,
        updatable: false,
        deletable: false,
        selectable: true,
      });
    } finally {
      await sql.end();
    }
  });

  it('books a review through the definer trigger when a signed-in student practices', async () => {
    await clear();

    // The practice write comes from a real signed-in session, so the trigger
    // runs with `authenticated` as its caller. Without `security definer` it
    // needs the INSERT grant this change revokes and the insert fails 42501;
    // with it, the activity row is booked as before.
    const { error } = await session.from('flashcard_practice').insert({
      user_id: userId,
      was_correct: true,
      practiced_at: new Date().toISOString(),
    });
    expect(error).toBeNull();

    expect(await storedReviewCounters()).toMatchObject({
      reviews_count: 1,
      reviews_correct: 1,
    });
  });
});
