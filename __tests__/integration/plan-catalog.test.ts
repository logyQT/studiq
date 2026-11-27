import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// #1494: the plan catalogue is migration-owned code.
//
// This suite is separate from `catalog-invariants.test.ts` on purpose. That
// suite pins the TypeScript↔database agreement of the *key* catalogs
// (`permissions`, `entitlement_catalog`, `limit_catalog`, flag presence); this
// one pins the *plan matrix* — which plans exist, what each sells and what each
// allows — plus the property that made the seed a second home: the migration
// that owns the matrix must be replayable.
//
// Before the fix these rows came from `supabase/seeds/00_plans.sql`, which
// DELETEd and re-inserted them on every `db reset`; production (`db push`,
// which never runs seeds) had no reproducible catalogue at all. The matrix here
// is a literal copy of the migration's, so the two must move together.
//
// B3 (#1495) makes an unlisted runtime plan a supported object: an admin
// creates it at runtime, pins it to an organization, and the public never sees
// it. The matrix is therefore the eight *public* rows. A runtime plan must not
// be counted, and a pre-B3 sweep that tries to delete one is refused by the
// pin's foreign key — that refusal is the protection, not a failure.

const CATALOGUE_FILE = path.join(
  process.cwd(),
  'supabase/migrations/20261127090000_org_team_tier.sql',
);

/**
 * The rename that preceded the team tier still owns `handle_new_user()`. Its guard
 * is exercised against its own file: the team-tier migration does not restate it.
 */
const RENAME_FILE = path.join(
  process.cwd(),
  'supabase/migrations/20261126170000_plan_key_rename_manager_plan.sql',
);

interface PlanMatrixEntry {
  scope: 'personal' | 'organization';
  /** `price_monthly` in minor units; a typo here must not pass the guard. */
  price: number;
  entitlements: string[];
  limits: Record<string, number>;
}

const MATRIX: Record<string, PlanMatrixEntry> = {
  free: {
    scope: 'personal',
    price: 0,
    entitlements: ['flashcards', 'quiz'],
    limits: {
      max_flashcards: 100,
      max_questions: 50,
      max_decks: 10,
      max_question_banks: 5,
      max_quiz_attempts_per_day: 10,
      max_ai_tokens_per_day: 0,
    },
  },
  plus: {
    scope: 'personal',
    price: 1999,
    entitlements: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates'],
    limits: {
      max_flashcards: 1000,
      max_questions: 500,
      max_decks: 100,
      max_question_banks: 50,
      max_quiz_attempts_per_day: 50,
      max_ai_tokens_per_day: 100000,
    },
  },
  pro: {
    scope: 'personal',
    price: 3999,
    entitlements: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
    limits: {
      max_flashcards: 5000,
      max_questions: 2000,
      max_decks: 500,
      max_question_banks: 200,
      max_quiz_attempts_per_day: 100,
      max_ai_tokens_per_day: 250000,
    },
  },
  max: {
    scope: 'personal',
    price: 7999,
    entitlements: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
    limits: {
      max_flashcards: 25000,
      max_questions: 10000,
      max_decks: 2000,
      max_question_banks: 1000,
      max_quiz_attempts_per_day: 200,
      max_ai_tokens_per_day: 500000,
    },
  },
  launch: {
    scope: 'organization',
    price: 0,
    entitlements: ['flashcards', 'quiz'],
    limits: {
      max_flashcards: 100,
      max_questions: 50,
      max_decks: 10,
      max_question_banks: 5,
      max_groups: 3,
      max_students: 5,
      max_quiz_attempts_per_day: 10,
    },
  },
  team: {
    scope: 'organization',
    price: 9900,
    entitlements: ['flashcards', 'quiz', 'quiz.templates'],
    limits: {
      max_flashcards: 1000,
      max_questions: 500,
      max_decks: 100,
      max_question_banks: 50,
      max_groups: 10,
      max_students: 25,
      max_quiz_attempts_per_day: 50,
    },
  },
  hub: {
    scope: 'organization',
    price: 29900,
    entitlements: ['flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
    limits: {
      max_flashcards: 5000,
      max_questions: 2500,
      max_decks: 500,
      max_question_banks: 200,
      max_groups: 40,
      max_students: 100,
      max_quiz_attempts_per_day: -1,
    },
  },
  campus: {
    scope: 'organization',
    price: 69900,
    entitlements: ['branding', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
    limits: {
      max_flashcards: -1,
      max_questions: -1,
      max_decks: -1,
      max_question_banks: -1,
      max_groups: 100,
      max_students: 1000,
      max_quiz_attempts_per_day: -1,
    },
  },
};

/** The organization ladder in the settled order: each tier adds one surface. */
const ORGANIZATION_LADDER = ['launch', 'team', 'hub', 'campus'] as const;

const EXPECTED_FLAGS = ['branding', 'quiz.templates', 'stats.insights'];

/**
 * A subscription mirror row the catalogue must leave alone: applying the
 * team-tier matrix re-writes plans, not a customer's subscription. The replay
 * test writes it inside the rolled-back transaction, so a migration that prunes
 * a mirror row (or a guard that omits it) fails the replay instead of passing on
 * an empty table.
 */
const REPLAY_USER_ID = '00000000-0000-4000-8000-0000000c0de1';
const REPLAY_CUSTOMER_ID = '00000000-0000-4000-8000-0000000c0de2';
const REPLAY_SUBSCRIPTION_ID = '00000000-0000-4000-8000-0000000c0de3';

/**
 * The key of the runtime contract plan a fresh stack creates for the replay
 * tests. A stack the QA worker has used already holds one; the row this name
 * inserts lives only inside the rolled-back transaction that needed it.
 */
const RUNTIME_PLAN_KEY = 'runtime_unlisted_probe';

interface Refusal {
  code: string;
  constraint?: string;
}

/** The error a refused statement rejects with; `NO_ERROR` means the statement ran. */
async function refusal(statement: () => Promise<unknown>): Promise<Refusal> {
  try {
    await statement();
    return { code: 'NO_ERROR' };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      return {
        code: String(error.code),
        ...('constraint_name' in error ? { constraint: String(error.constraint_name) } : {}),
      };
    }
    throw error;
  }
}

async function seedSubscription(tx: postgres.ISql): Promise<void> {
  await tx.unsafe(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
       'plan-replay@test.local', crypt('pass', gen_salt('bf')), now(),
       '{"account_type":"student"}'::jsonb, '{}'::jsonb, now(), now()
     )`,
    [REPLAY_USER_ID],
  );
  await tx.unsafe(
    `insert into public.billing_customers (id, user_id, stripe_customer_id, livemode)
     values ($1, $2, 'cus_plan_replay', false)`,
    [REPLAY_CUSTOMER_ID, REPLAY_USER_ID],
  );
  await tx.unsafe(
    `insert into public.billing_subscriptions (
       id, stripe_subscription_id, billing_customer_id, user_id, plan_key,
       price_id, status, livemode, entitlement_applied_plan_key
     ) values (
       $1, 'sub_plan_replay', $2, $3, 'hub', 'price_plan_replay', 'active', false, 'hub'
     )`,
    [REPLAY_SUBSCRIPTION_ID, REPLAY_CUSTOMER_ID, REPLAY_USER_ID],
  );
}

async function appliedKey(tx: postgres.ISql): Promise<string | null> {
  const rows = await tx.unsafe<Array<{ key: string | null }>>(
    `select entitlement_applied_plan_key as key
     from public.billing_subscriptions where id = $1`,
    [REPLAY_SUBSCRIPTION_ID],
  );
  return rows[0]?.key ?? null;
}

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/**
 * The replay needs the migration file applied to this checkout's own database.
 * A run without the URL must fail rather than skip: a skipped replay would let
 * a non-idempotent statement pass its own suite.
 */
function requireLocalDatabaseUrl(): string {
  if (!localDatabaseUrl) {
    throw new Error(
      "plan-catalog needs SUPABASE_DB_URL pointing at this checkout's local Supabase to " +
        'replay the catalogue migration. Run the suite through ' +
        '`bun run env:run -- bun run test:integration`.',
    );
  }
  return localDatabaseUrl;
}

async function withDirect<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

interface CatalogSnapshot {
  plans: Array<{
    key: string;
    scope: string;
    price_monthly: number | null;
  }>;
  entitlements: Array<{ plan_key: string; entitlement_key: string }>;
  limits: Array<{ plan_key: string; limit_key: string; limit_value: number }>;
}

// `ISql` is what a pooled handle and a transaction handle share, so the same
// reader works inside and outside `sql.begin`.
async function readSnapshot(sql: postgres.ISql): Promise<CatalogSnapshot> {
  return {
    plans: await sql<
      CatalogSnapshot['plans']
    >`select key, scope, price_monthly from public.subscription_plans order by key`,
    entitlements: await sql<
      CatalogSnapshot['entitlements']
    >`select plan_key, entitlement_key from public.plan_entitlements order by plan_key, entitlement_key`,
    limits: await sql<
      CatalogSnapshot['limits']
    >`select plan_key, limit_key, limit_value from public.plan_limits order by plan_key, limit_key`,
  };
}

/** The keys of every plan row the eight-plan matrix does not list. */
async function runtimePlanKeys(tx: postgres.ISql): Promise<string[]> {
  const rows = await tx<Array<{ key: string }>>`
    select key from public.subscription_plans
    where not (key = any(${Object.keys(MATRIX)}::text[]))
    order by key`;
  return rows.map((row) => row.key);
}

/**
 * The key of an unlisted runtime plan. A stack the QA worker used already holds
 * one; a fresh stack gets a temporary row that the caller's rollback removes.
 */
async function ensureUnlistedRuntimePlan(tx: postgres.ISql): Promise<string> {
  const existing = await tx<Array<{ key: string }>>`
    select key from public.subscription_plans
    where visibility = 'unlisted'
    order by key
    limit 1`;
  if (existing[0]) return existing[0].key;

  await tx.unsafe(
    `insert into public.subscription_plans
       (key, name, scope, visibility, billing_mode, price_monthly, sort_order)
     values ($1, 'Runtime contract probe', 'organization', 'unlisted', 'invoice', 0, 900)`,
    [RUNTIME_PLAN_KEY],
  );
  return RUNTIME_PLAN_KEY;
}

/** The same plan, pinned to an organization, which is how B3 supports it. */
async function ensurePinnedRuntimePlan(tx: postgres.ISql): Promise<string> {
  const pinned = await tx<Array<{ plan_key: string }>>`
    select pa.plan_key
    from public.plan_assignments pa
    join public.subscription_plans pl on pl.key = pa.plan_key
    where pl.visibility = 'unlisted'
    order by pa.created_at
    limit 1`;
  if (pinned[0]) return pinned[0].plan_key;

  const planKey = await ensureUnlistedRuntimePlan(tx);
  const org = await tx<Array<{ id: string }>>`
    insert into public.organizations (name) values ('plan-catalog runtime probe') returning id`;
  await tx.unsafe(
    `insert into public.plan_assignments (plan_key, organization_id) values ($1, $2)`,
    [planKey, org[0]!.id],
  );
  return planKey;
}

/**
 * Unpin and remove every plan the matrix does not list, so a pre-B3 sweep has
 * nothing to refuse. The organization moves first: the unpin trigger refuses to
 * orphan an organization that is still on the plan, and `organizations.plan`
 * blocks the delete on its own.
 */
async function releaseRuntimePlans(tx: postgres.ISql): Promise<string[]> {
  const keys = await runtimePlanKeys(tx);
  if (keys.length === 0) return keys;

  await tx.unsafe(`update public.organizations set plan = 'launch' where plan = any($1::text[])`, [
    keys,
  ]);
  await tx.unsafe(`delete from public.plan_assignments where plan_key = any($1::text[])`, [keys]);
  await tx.unsafe(`delete from public.subscription_plans where key = any($1::text[])`, [keys]);
  return keys;
}

describe('plan catalogue is migration-owned (#1494)', () => {
  let service: SupabaseClient<Database>;
  let planRows: Array<{
    key: string;
    scope: string;
    price_monthly: number | null;
    sort_order: number;
    visibility: string;
    billing_mode: string;
  }>;
  let entitlementRows: Array<{ plan_key: string; entitlement_key: string }>;
  let limitRows: Array<{ plan_key: string; limit_key: string; limit_value: number }>;
  let flagKeys: string[];

  beforeAll(async () => {
    service = createServiceClient();

    // The full live table can hold an inactive fixture plan another suite
    // created; the catalogue is the active set the product sells.
    const { data: plans, error: plansError } = await service
      .from('subscription_plans')
      .select('key, scope, price_monthly, sort_order, visibility, billing_mode')
      .eq('is_active', true)
      .order('key');
    if (plansError) throw new Error(`[plan-catalog] plan lookup failed: ${plansError.message}`);
    planRows = dbRows(plans);

    const { data: entitlements, error: entitlementsError } = await service
      .from('plan_entitlements')
      .select('plan_key, entitlement_key')
      .order('plan_key')
      .order('entitlement_key');
    if (entitlementsError) {
      throw new Error(
        `[plan-catalog] plan_entitlements lookup failed: ${entitlementsError.message}`,
      );
    }
    entitlementRows = dbRows(entitlements);

    const { data: limits, error: limitsError } = await service
      .from('plan_limits')
      .select('plan_key, limit_key, limit_value');
    if (limitsError) {
      throw new Error(`[plan-catalog] plan_limits lookup failed: ${limitsError.message}`);
    }
    limitRows = dbRows(limits);

    const { data: flags, error: flagsError } = await service
      .from('entitlement_flags')
      .select('key');
    if (flagsError) {
      throw new Error(`[plan-catalog] entitlement_flags lookup failed: ${flagsError.message}`);
    }
    flagKeys = dbRows(flags).map((row) => row.key);
  });

  function entitlementsFor(planKey: string): string[] {
    return entitlementRows
      .filter((row) => row.plan_key === planKey)
      .map((row) => row.entitlement_key)
      .toSorted();
  }

  function limitsFor(planKey: string): Record<string, number> {
    return Object.fromEntries(
      limitRows
        .filter((row) => row.plan_key === planKey)
        .map((row) => [row.limit_key, row.limit_value]),
    );
  }

  function getOrgLadder(): string[] {
    return planRows
      .filter((row) => row.scope === 'organization' && row.visibility === 'public')
      .toSorted((a, b) => a.sort_order - b.sort_order)
      .map((row) => row.key);
  }

  /** The rows the product sells: an unlisted contract plan is not one of them (B3). */
  function publicPlanRows() {
    return planRows.filter((row) => row.visibility === 'public');
  }

  it('is exactly the eight public matrix plans, with the expected scope/price, all public and Stripe-billed', () => {
    // Exclusivity holds over the public catalogue, not the whole table: an admin
    // creates an unlisted contract plan at runtime and pins it to an
    // organization (B3, #1495).
    expect(new Set(publicPlanRows().map((row) => row.key))).toEqual(new Set(Object.keys(MATRIX)));

    for (const [key, expected] of Object.entries(MATRIX)) {
      const row = planRows.find((plan) => plan.key === key);
      if (!row) throw new Error(`subscription_plans row missing for ${key}`);

      // `price` is pinned here because the closing guard covers it too: a
      // digit typo (`69900 → 6990`) must fail one of the two, not slip through.
      // `visibility`/`billing_mode` stay at the column defaults: the matrix
      // sells the public catalogue, and a contract plan is created at runtime.
      expect(
        {
          scope: row.scope,
          price: row.price_monthly,
          visibility: row.visibility,
          billingMode: row.billing_mode,
        },
        key,
      ).toEqual({
        scope: expected.scope,
        price: expected.price,
        visibility: 'public',
        billingMode: 'stripe',
      });
    }
  });

  it('keeps a runtime unlisted plan out of the public matrix', async () => {
    // The QA stack holds one already; a fresh stack gets a temporary row that
    // the rollback removes. Either way the public set is the eight, and the
    // unlisted plan is not counted.
    const rollback = new Error('public matrix: roll back');
    let unlistedKey: string | undefined;

    const probe = withDirect(async (sql) => {
      await sql.begin(async (tx) => {
        unlistedKey = await ensureUnlistedRuntimePlan(tx);

        const publicKeys = (
          await tx<Array<{ key: string }>>`
            select key from public.subscription_plans
            where visibility = 'public'
            order by key`
        ).map((row) => row.key);

        expect(publicKeys, 'the public catalogue is the eight matrix plans').toEqual(
          Object.keys(MATRIX).toSorted(),
        );
        expect(publicKeys, `${unlistedKey} is unlisted`).not.toContain(unlistedKey);

        throw rollback;
      });
    });

    await expect(probe).rejects.toBe(rollback);
  });

  it('the retired individual keys are absent from the catalogue', () => {
    for (const retired of ['base', 'spark', 'ace']) {
      expect(
        planRows.map((row) => row.key),
        retired,
      ).not.toContain(retired);
    }
  });

  it('subscription_plans carries no audience column (#1193 cleanup)', async () => {
    const rows = await withDirect(
      (sql) => sql<Array<{ n: number }>>`
        select count(*)::int as n
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'subscription_plans'
          and column_name = 'audience'`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('the replay guard rejects a personal plan for a manager', async () => {
    const migrationSql = readFileSync(RENAME_FILE, 'utf8');
    const broken = migrationSql.replace('    plan_key_val := null;', "    plan_key_val := 'free';");
    expect(broken, 'this test needs the null assignment in the migration').not.toBe(migrationSql);

    const before = await withDirect(readSnapshot);
    const rollback = new Error('guard replay: roll back');
    let pinnedRuntimeRefusal: Refusal | undefined;
    let sweptRefusal: Refusal | undefined;

    const replay = withDirect(async (sql) => {
      await sql.begin(async (tx) => {
        // A runtime unlisted plan is pinned to an organization (B3). The pre-B3
        // sweep deletes every plan its matrix does not list, and the pin's
        // `on delete restrict` refuses that delete with `23503`. That refusal
        // is the protection, not a failure.
        const runtimeKey = await ensurePinnedRuntimePlan(tx);
        await tx.unsafe('savepoint pinned_replay');
        pinnedRuntimeRefusal = await refusal(() => tx.unsafe(broken));
        await tx.unsafe('rollback to savepoint pinned_replay');

        // With the pin and the plan gone, the file runs as it did before B3 and
        // stops at its own closing guard.
        const released = await releaseRuntimePlans(tx);
        expect(released, 'the pinned runtime plan was released for the second replay').toContain(
          runtimeKey,
        );
        await tx.unsafe('savepoint unpinned_replay');
        sweptRefusal = await refusal(() => tx.unsafe(broken));
        await tx.unsafe('rollback to savepoint unpinned_replay');

        throw rollback;
      });
    });

    // A different error must not be mistaken for the rollback signal.
    await expect(replay).rejects.toBe(rollback);

    expect(pinnedRuntimeRefusal).toMatchObject({
      code: '23503',
      constraint: 'plan_assignments_plan_key_fkey',
    });
    // `42883` is the guard's exception; `NO_ERROR` would mean it let the branch
    // mint a personal plan for a manager through.
    expect(sweptRefusal).toMatchObject({ code: '42883' });

    // Both attempts rolled back: the runtime plan and its child rows are still
    // there for the next run.
    expect(await withDirect(readSnapshot)).toEqual(before);
  });

  it('the public organization ladder is four purchasable tiers with cumulative features', () => {
    expect(getOrgLadder()).toEqual([...ORGANIZATION_LADDER]);

    for (let tier = 1; tier < ORGANIZATION_LADDER.length; tier += 1) {
      const lower = entitlementsFor(ORGANIZATION_LADDER[tier - 1]!);
      const upper = entitlementsFor(ORGANIZATION_LADDER[tier]!);
      expect(
        lower.filter((key) => !upper.includes(key)),
        ORGANIZATION_LADDER[tier],
      ).toEqual([]);
      expect(upper.length, ORGANIZATION_LADDER[tier]).toBeGreaterThan(lower.length);
    }
  });

  it('never makes an organization plan a seat pool', () => {
    // A pool is a licence of a personal plan (D15/D32); the migration aborts on
    // one that names an organization tier, and the live database has none.
    return withDirect(async (sql) => {
      const rows = await sql<Array<{ n: number }>>`
        select count(*)::int as n
        from public.org_seat_pools sp
        join public.subscription_plans pl on pl.key = sp.plan_key
        where pl.scope = 'organization'`;
      expect(rows[0]?.n).toBe(0);
    });
  });

  it('no organization plan carries an AI quota (AI is an organization licence in #1511)', () => {
    for (const [key, expected] of Object.entries(MATRIX)) {
      if (expected.scope !== 'organization') continue;
      expect(limitsFor(key), key).not.toHaveProperty('max_ai_tokens_per_day');
    }
  });

  it('each plan carries exactly its matrix entitlement set, and none is empty', () => {
    for (const [key, expected] of Object.entries(MATRIX)) {
      const keys = entitlementsFor(key);
      // A plan with no rows sells nothing at all; name the plan before the
      // exact-set diff so the failure reads as the contract it breaks.
      expect(keys, `${key} carries no entitlement rows`).not.toEqual([]);
      expect(keys, key).toEqual([...expected.entitlements].toSorted());
    }
  });

  it('each plan carries exactly its matrix limits, values included', () => {
    for (const [key, expected] of Object.entries(MATRIX)) {
      expect(limitsFor(key), key).toEqual(expected.limits);
    }
  });

  it('the flag rows the catalogue depends on exist', () => {
    expect(flagKeys).toEqual(expect.arrayContaining(EXPECTED_FLAGS));
  });

  it('replaying the team tier refuses to sweep a pinned runtime plan, then leaves the same matrix', async () => {
    const migrationSql = readFileSync(CATALOGUE_FILE, 'utf8');
    const before = await withDirect(readSnapshot);

    // The replay runs inside one transaction that ends by throwing, so these
    // tests touch no shared row: the live database is compared with `before`
    // below after the rollback.
    const rollback = new Error('plan-catalog replay: roll back');
    let duringRun: CatalogSnapshot | undefined;
    let pinnedRuntimeRefusal: Refusal | undefined;

    const replay = withDirect(async (sql) => {
      await sql.begin(async (tx) => {
        await seedSubscription(tx);
        expect(await appliedKey(tx), 'the fixture starts on a live tier').toBe('hub');

        // B3: an admin created this plan at runtime and pinned it to an
        // organization. The declarative sweep deletes every plan the matrix does
        // not list, and the pin's `on delete restrict` refuses it with `23503`.
        const runtimeKey = await ensurePinnedRuntimePlan(tx);
        await tx.unsafe('savepoint pinned_replay');
        pinnedRuntimeRefusal = await refusal(() => tx.unsafe(migrationSql));
        await tx.unsafe('rollback to savepoint pinned_replay');

        // Released inside the transaction, the sweep runs as it did before B3:
        // twice, and the matrix is unchanged.
        const released = await releaseRuntimePlans(tx);
        expect(released, 'the pinned runtime plan was released for the sweep').toContain(
          runtimeKey,
        );
        await tx.unsafe(migrationSql);
        await tx.unsafe(migrationSql);

        // The migration writes the catalogue, not a customer's subscription.
        expect(await appliedKey(tx), 'the mirror row is left alone').toBe('hub');

        duringRun = await readSnapshot(tx);

        throw rollback;
      });
    });

    // A different error must not be mistaken for the rollback signal.
    await expect(replay).rejects.toBe(rollback);

    expect(pinnedRuntimeRefusal).toMatchObject({
      code: '23503',
      constraint: 'plan_assignments_plan_key_fkey',
    });
    if (!duringRun) {
      throw new Error('the replay transaction never reached its assertions');
    }

    // The replayed catalogue is the matrix itself, row for row, after both
    // applications — not only the same row count.
    expect(duringRun.plans).toEqual(
      Object.entries(MATRIX)
        .map(([key, plan]) => ({
          key,
          scope: plan.scope,
          price_monthly: plan.price,
        }))
        .toSorted((a, b) => a.key.localeCompare(b.key)),
    );
    expect(duringRun.entitlements).toEqual(
      Object.entries(MATRIX)
        .flatMap(([planKey, plan]) =>
          plan.entitlements.map((entitlement_key) => ({ plan_key: planKey, entitlement_key })),
        )
        .toSorted((a, b) =>
          `${a.plan_key}.${a.entitlement_key}`.localeCompare(`${b.plan_key}.${b.entitlement_key}`),
        ),
    );
    expect(duringRun.limits).toEqual(
      Object.entries(MATRIX)
        .flatMap(([planKey, plan]) =>
          Object.entries(plan.limits).map(([limit_key, limit_value]) => ({
            plan_key: planKey,
            limit_key,
            limit_value,
          })),
        )
        .toSorted((a, b) =>
          `${a.plan_key}.${a.limit_key}`.localeCompare(`${b.plan_key}.${b.limit_key}`),
        ),
    );

    // The rollback is clean: the live database never saw any of it.
    expect(await withDirect(readSnapshot)).toEqual(before);
  });
});
