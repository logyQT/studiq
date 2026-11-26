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

const MIGRATION_FILE = path.join(
  process.cwd(),
  'supabase/migrations/20261126130000_individual_plan_ladder.sql',
);

interface PlanMatrixEntry {
  scope: 'personal' | 'organization';
  audience: 'student' | 'educator' | 'manager' | null;
  /** `price_monthly` in minor units; a typo here must not pass the guard. */
  price: number;
  entitlements: string[];
  limits: Record<string, number>;
}

const MATRIX: Record<string, PlanMatrixEntry> = {
  base: {
    scope: 'personal',
    audience: null,
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
  spark: {
    scope: 'personal',
    audience: null,
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
  ace: {
    scope: 'personal',
    audience: null,
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
  pro: {
    scope: 'personal',
    audience: null,
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
    audience: null,
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
      max_ai_tokens_per_day: 0,
    },
  },
  team: {
    scope: 'organization',
    audience: null,
    price: 9900,
    entitlements: ['flashcards', 'quiz', 'quiz.templates'],
    limits: {
      max_flashcards: 500,
      max_questions: 200,
      max_decks: 50,
      max_question_banks: 20,
      max_groups: 5,
      max_students: 5,
      max_quiz_attempts_per_day: 50,
      max_ai_tokens_per_day: 0,
    },
  },
  hub: {
    scope: 'organization',
    audience: null,
    price: 29900,
    entitlements: ['ai.chat', 'branding', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
    limits: {
      max_flashcards: 2000,
      max_questions: 1000,
      max_decks: 200,
      max_question_banks: 100,
      max_groups: 20,
      max_students: 50,
      max_quiz_attempts_per_day: -1,
      max_ai_tokens_per_day: 200000,
    },
  },
  campus: {
    scope: 'organization',
    audience: null,
    price: 69900,
    entitlements: ['ai.chat', 'branding', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
    limits: {
      max_flashcards: -1,
      max_questions: -1,
      max_decks: -1,
      max_question_banks: -1,
      max_groups: -1,
      max_students: -1,
      max_quiz_attempts_per_day: -1,
      max_ai_tokens_per_day: -1,
    },
  },
};

const EXPECTED_FLAGS = ['branding', 'quiz.templates', 'stats.insights'];

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
    audience: string | null;
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
    >`select key, scope, audience, price_monthly from public.subscription_plans order by key`,
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
    audience: string | null;
    price_monthly: number | null;
  }>;
  let entitlementRows: Array<{ plan_key: string; entitlement_key: string }>;
  let limitRows: Array<{ plan_key: string; limit_key: string; limit_value: number }>;
  let flagKeys: string[];

  beforeAll(async () => {
    service = createServiceClient();

    const { data: plans, error: plansError } = await service
      .from('subscription_plans')
      .select('key, scope, audience, price_monthly')
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

  it('is exactly the eight matrix plans, with the expected scope/audience/price', () => {
    expect(new Set(planRows.map((row) => row.key))).toEqual(new Set(Object.keys(MATRIX)));

    for (const [key, expected] of Object.entries(MATRIX)) {
      const row = planRows.find((plan) => plan.key === key);
      if (!row) throw new Error(`subscription_plans row missing for ${key}`);

      // `price` is pinned here because the closing guard covers it too: a
      // digit typo (`69900 → 6990`) must fail one of the two, not slip through.
      expect({ scope: row.scope, audience: row.audience, price: row.price_monthly }, key).toEqual({
        scope: expected.scope,
        audience: expected.audience,
        price: expected.price,
      });
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

  it('replaying the migration twice deletes rows outside the matrix, in a rolled-back transaction', async () => {
    const migrationSql = readFileSync(MIGRATION_FILE, 'utf8');
    const before = await withDirect(readSnapshot);

    // The replay runs inside one transaction that ends by throwing, so this
    // test touches no shared row: the live database is compared with `before`
    // below after the rollback. Running the file for real (the previous
    // version) deleted every plan outside the matrix on each test run — which
    // includes the org-pinned plans #1495 adds — and raced every other
    // integration file that creates a plan or a seat pool.
    const rollback = new Error('plan-catalog replay: roll back');
    let duringRun: CatalogSnapshot | undefined;
    let survivors: { plans: number; entitlements: number; limits: number } | undefined;

    const replay = withDirect(async (sql) => {
      await sql.begin(async (tx) => {
        await tx`insert into public.subscription_plans
            (key, name, price_monthly, currency, sort_order, scope, audience)
          values ('zz_rogue_plan', 'Rogue replay plan', 0, 'PLN', 99, 'personal', null)`;
        await tx`insert into public.plan_entitlements (plan_key, entitlement_key)
          values ('zz_rogue_plan', 'quiz')`;
        await tx`insert into public.plan_limits (plan_key, limit_key, limit_value)
          values ('zz_rogue_plan', 'max_flashcards', 1)`;

        await tx.unsafe(migrationSql);
        await tx.unsafe(migrationSql);

        duringRun = await readSnapshot(tx);
        const [rogue] = await tx<
          Array<{ plans: number; entitlements: number; limits: number }>
        >`select
            (select count(*) from public.subscription_plans where key = 'zz_rogue_plan')::int as plans,
            (select count(*) from public.plan_entitlements where plan_key = 'zz_rogue_plan')::int as entitlements,
            (select count(*) from public.plan_limits where plan_key = 'zz_rogue_plan')::int as limits`;
        survivors = rogue;

        throw rollback;
      });
    });

    // A different error must not be mistaken for the rollback signal.
    await expect(replay).rejects.toBe(rollback);
    if (!duringRun || !survivors) {
      throw new Error('the replay transaction never reached its assertions');
    }

    // The rogue plan and both of its child rows are gone. `before`/`after`
    // equality could not prove this: an additive-only file leaves a clean
    // database unchanged, so it passed while proving nothing.
    expect(survivors).toEqual({ plans: 0, entitlements: 0, limits: 0 });

    // The replayed catalogue is the matrix itself, row for row, after both
    // applications — not only the same row count.
    expect(duringRun.plans).toEqual(
      Object.entries(MATRIX)
        .map(([key, plan]) => ({
          key,
          scope: plan.scope,
          audience: plan.audience,
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
