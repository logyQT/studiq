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
      .filter((row) => row.scope === 'organization')
      .toSorted((a, b) => a.sort_order - b.sort_order)
      .map((row) => row.key);
  }

  it('is exactly the eight matrix plans, with the expected scope/price, all public and Stripe-billed', () => {
    expect(new Set(planRows.map((row) => row.key))).toEqual(new Set(Object.keys(MATRIX)));

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

    const rollback = new Error('guard replay: roll back');
    const outcome = await withDirect(async (sql) => {
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(broken);
          throw rollback;
        });
      } catch (error) {
        if (error === rollback) return 'ROLLED_BACK';
        if (error && typeof error === 'object' && 'code' in error) return String(error.code);
        return String(error);
      }
      return 'NO_ERROR';
    });

    // `42883` is the guard's exception; `ROLLED_BACK` would mean it let the
    // branch mint a personal plan for a manager through.
    expect(outcome).toBe('42883');
  });

  it('the organization ladder is four purchasable tiers with cumulative features', () => {
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

  it('replaying the team tier twice leaves the same matrix, in a rolled-back transaction', async () => {
    const migrationSql = readFileSync(CATALOGUE_FILE, 'utf8');
    const before = await withDirect(readSnapshot);

    // The replay runs inside one transaction that ends by throwing, so this
    // test touches no shared row: the live database is compared with `before`
    // below after the rollback.
    const rollback = new Error('plan-catalog replay: roll back');
    let duringRun: CatalogSnapshot | undefined;

    const replay = withDirect(async (sql) => {
      await sql.begin(async (tx) => {
        await seedSubscription(tx);
        expect(await appliedKey(tx), 'the fixture starts on a live tier').toBe('hub');

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
