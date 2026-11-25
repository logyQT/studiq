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
  'supabase/migrations/20261125170000_plan_catalog_owned_by_migrations.sql',
);

interface PlanMatrixEntry {
  scope: 'personal' | 'organization';
  audience: 'student' | 'educator' | 'manager' | null;
  entitlements: string[];
  limits: Record<string, number>;
}

const MATRIX: Record<string, PlanMatrixEntry> = {
  base: {
    scope: 'personal',
    audience: 'student',
    entitlements: ['flashcards', 'quiz'],
    limits: {
      max_flashcards: 100,
      max_questions: 50,
      max_decks: 10,
      max_question_banks: 5,
      max_quiz_attempts_per_day: 10,
      max_ai_tokens_per_day: 0,
      max_students: -1,
      max_groups: -1,
    },
  },
  lite: {
    scope: 'personal',
    audience: 'educator',
    entitlements: ['flashcards', 'quiz'],
    limits: {
      max_flashcards: 100,
      max_questions: 50,
      max_decks: 10,
      max_question_banks: 5,
      max_groups: 1,
      max_students: 5,
      max_quiz_attempts_per_day: 10,
      max_ai_tokens_per_day: 0,
    },
  },
  launch: {
    scope: 'organization',
    audience: null,
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
  spark: {
    scope: 'personal',
    audience: 'student',
    entitlements: ['flashcards', 'quiz'],
    limits: {
      max_flashcards: 500,
      max_questions: 200,
      max_decks: 50,
      max_question_banks: 20,
      max_quiz_attempts_per_day: 50,
      max_ai_tokens_per_day: 0,
    },
  },
  guide: {
    scope: 'personal',
    audience: 'educator',
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
  team: {
    scope: 'organization',
    audience: null,
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
  ace: {
    scope: 'personal',
    audience: 'student',
    entitlements: ['ai.chat', 'flashcards', 'quiz', 'stats.insights'],
    limits: {
      max_flashcards: 2000,
      max_questions: 1000,
      max_decks: 200,
      max_question_banks: 100,
      max_quiz_attempts_per_day: -1,
      max_ai_tokens_per_day: 200000,
    },
  },
  creator: {
    scope: 'personal',
    audience: 'educator',
    entitlements: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
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
  hub: {
    scope: 'organization',
    audience: null,
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
  pro: {
    scope: 'personal',
    audience: 'student',
    entitlements: ['ai.chat', 'flashcards', 'quiz', 'stats.insights'],
    limits: {
      max_flashcards: -1,
      max_questions: -1,
      max_decks: -1,
      max_question_banks: -1,
      max_quiz_attempts_per_day: -1,
      max_ai_tokens_per_day: -1,
    },
  },
  master: {
    scope: 'personal',
    audience: 'educator',
    entitlements: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
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
  campus: {
    scope: 'organization',
    audience: null,
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
  solo: {
    scope: 'personal',
    audience: 'manager',
    entitlements: ['flashcards', 'quiz'],
    limits: {
      max_flashcards: 100,
      max_questions: 50,
      max_decks: 10,
      max_question_banks: 5,
      max_quiz_attempts_per_day: 10,
      max_ai_tokens_per_day: 0,
      max_students: -1,
      max_groups: -1,
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
  plans: Array<{ key: string; scope: string; audience: string | null }>;
  entitlements: Array<{ plan_key: string; entitlement_key: string }>;
  limits: Array<{ plan_key: string; limit_key: string; limit_value: number }>;
}

async function readSnapshot(sql: postgres.Sql): Promise<CatalogSnapshot> {
  return {
    plans: await sql<
      CatalogSnapshot['plans']
    >`select key, scope, audience from public.subscription_plans order by key`,
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
  let planRows: Array<{ key: string; scope: string; audience: string | null }>;
  let entitlementRows: Array<{ plan_key: string; entitlement_key: string }>;
  let limitRows: Array<{ plan_key: string; limit_key: string; limit_value: number }>;
  let flagKeys: string[];

  beforeAll(async () => {
    service = createServiceClient();

    const { data: plans, error: plansError } = await service
      .from('subscription_plans')
      .select('key, scope, audience')
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

  it('is exactly the thirteen matrix plans, with the expected scope/audience', () => {
    expect(new Set(planRows.map((row) => row.key))).toEqual(new Set(Object.keys(MATRIX)));

    for (const [key, expected] of Object.entries(MATRIX)) {
      const row = planRows.find((plan) => plan.key === key);
      if (!row) throw new Error(`subscription_plans row missing for ${key}`);

      expect({ scope: row.scope, audience: row.audience }, key).toEqual({
        scope: expected.scope,
        audience: expected.audience,
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

  it('re-applying the migration twice leaves the same matrix', async () => {
    const migrationSql = readFileSync(MIGRATION_FILE, 'utf8');
    const before = await withDirect(readSnapshot);

    await withDirect((sql) => sql.unsafe(migrationSql));
    await withDirect((sql) => sql.unsafe(migrationSql));

    const after = await withDirect(readSnapshot);
    expect(after).toEqual(before);

    // The exact sizes pin "declarative, not additive": a leftover row or a
    // second application that appended would change the counts.
    expect(after.plans).toHaveLength(Object.keys(MATRIX).length);
    expect(after.entitlements).toHaveLength(
      Object.values(MATRIX).reduce((total, entry) => total + entry.entitlements.length, 0),
    );
    expect(after.limits).toHaveLength(
      Object.values(MATRIX).reduce((total, entry) => total + Object.keys(entry.limits).length, 0),
    );
  });
});
