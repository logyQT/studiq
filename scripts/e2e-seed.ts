/**
 * e2e seeder — materialises one isolated tenant per test (file × title × browser)
 * before the suite starts, so every spec owns its org, users and content.
 *
 * Design notes:
 * - Auth users are inserted straight into `auth.users` (bcrypt), like
 *   `supabase/seeds/01_seed.sql`; GoTrue accepts them without `auth.identities`.
 * - Domain rows go through the service-role client, typed against the generated
 *   `Database` type, so a schema change breaks this file at compile time.
 * - Every id is a uuidv5 of `<tenant>:<entity>`, so a test can address its rows
 *   without a query and a failing run reproduces the same ids.
 *
 * Usage:
 *   bun scripts/e2e-seed.ts            # seed everything the suite will run
 *   bun scripts/e2e-seed.ts --reset    # drop e2e tenants first
 *   bun scripts/e2e-seed.ts --only <key>
 */
import { SQL } from 'bun';
import type { Database } from '@studiq/server/types/database';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shortHash, tenantKey, uuidv5 } from '#test/e2e/fixtures/ids';
import { profileFor } from '#test/e2e/fixtures/profiles';
import {
  buildAccount,
  createSeedDb,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

type Role = 'teacher' | 'student';

interface TenantUser {
  id: string;
  email: string;
  password: string;
  role: Role;
  accountType: 'educator' | 'student';
}

interface Tenant {
  key: string;
  file: string;
  title: string;
  project: string;
  profile: string;
  org: { id: string; name: string };
  users: Record<Role, TenantUser>;
  ids: {
    group: string;
    deck: string;
    deck2: string;
    bank: string;
    bank2: string;
    quiz: string;
    assignment: string;
  };
}

const ROOT = join(import.meta.dir, '..');
const SEED_DIR = join(ROOT, '__tests__/e2e/.seed');
const INDEX = join(SEED_DIR, 'index.json');
function env(name: string, fallback?: string): string {
  if (process.env[name]) return process.env[name]!;
  if (fallback) return fallback;
  // local convenience: reuse the web app's dev env
  try {
    const raw = readFileSync(join(ROOT, 'apps/web/.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0 && line.slice(0, i).trim() === name) return line.slice(i + 1).trim();
    }
  } catch {
    /* no .env */
  }
  throw new Error(`missing env ${name}`);
}

const DB_URL = env('SUPABASE_DB_URL', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
const SUPABASE_URL = env('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

const sql = new SQL(DB_URL);
const db = createSeedDb({ url: SUPABASE_URL, serviceKey: SERVICE_KEY });

/* ------------------------------------------------------------------ manifest */

async function listTests(): Promise<Array<{ file: string; title: string; project: string }>> {
  const proc = Bun.spawn(['bunx', 'playwright', 'test', '--list', '--reporter=json'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const report = JSON.parse(out) as {
    suites?: Array<{
      file?: string;
      specs?: Array<{ title: string; tests?: Array<{ projectName: string }> }>;
      suites?: unknown[];
    }>;
  };
  const found: Array<{ file: string; title: string; project: string }> = [];
  const walk = (suites: Array<Record<string, unknown>>) => {
    for (const s of suites) {
      const file = (s.file as string) ?? '';
      for (const spec of (s.specs as Array<{
        title: string;
        tests?: Array<{ projectName: string }>;
      }>) ?? []) {
        for (const t of spec.tests ?? []) {
          found.push({ file, title: spec.title, project: t.projectName });
        }
      }
      walk((s.suites as Array<Record<string, unknown>>) ?? []);
    }
  };
  walk((report.suites as Array<Record<string, unknown>>) ?? []);
  return found;
}

/* ------------------------------------------------------------------- tenants */

function buildTenant(file: string, title: string, project: string): Tenant {
  const key = tenantKey(file, title, project);
  const tag = shortHash(key);
  const teacher = buildAccount(key, 'teacher', 'educator', {
    email: `e2e+${tag}+teacher@test.local`,
    name: 'teacher',
  });
  const student = buildAccount(key, 'student', 'student', {
    email: `e2e+${tag}+student@test.local`,
    name: 'student',
  });
  return {
    key,
    file,
    title,
    project,
    profile: profileFor(file),
    org: { id: tenantId(key, 'org'), name: `e2e ${tag}` },
    users: {
      teacher: {
        id: teacher.id,
        email: teacher.email,
        password: teacher.password,
        role: 'teacher',
        accountType: 'educator',
      },
      student: {
        id: student.id,
        email: student.email,
        password: student.password,
        role: 'student',
        accountType: 'student',
      },
    },
    ids: {
      group: tenantId(key, 'group'),
      deck: tenantId(key, 'deck'),
      deck2: tenantId(key, 'deck2'),
      bank: tenantId(key, 'bank'),
      bank2: tenantId(key, 'bank2'),
      quiz: tenantId(key, 'quiz'),
      assignment: tenantId(key, 'assignment'),
    },
  };
}

async function seedTenant(t: Tenant): Promise<void> {
  const teacher: SeedAccount = { ...t.users.teacher, role: 'educator' };
  const student: SeedAccount = { ...t.users.student, role: 'student' };

  await seedTenantGraph(db, {
    key: t.key,
    org: t.org,
    defaultGroup: { id: t.ids.group, name: 'G1', isDefault: false },
    extraGroups: [],
    owner: teacher,
    members: [student],
    ownerOrgRole: 'teacher',
  });

  type Res = { error: { message: string; details?: string | null } | null };
  const run = async (batch: Array<PromiseLike<Res>>) => {
    const results = await Promise.all(batch);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      throw new Error(`seed ${t.key}: ${failed.error.message} (${failed.error.details ?? ''})`);
    }
  };

  if (t.profile !== 'content') return;

  // Content profile: decks, banks, a quiz and a published assignment.
  await run([
    db.from('flashcard_decks').upsert(
      [
        {
          id: t.ids.deck,
          organization_id: t.org.id,
          created_by: teacher.id,
          name: 'Deck A',
          visibility: 'group',
        },
        {
          id: t.ids.deck2,
          organization_id: t.org.id,
          created_by: teacher.id,
          name: 'Deck B',
          visibility: 'group',
        },
      ],
      { onConflict: 'id' },
    ),
    db.from('question_banks').upsert(
      [
        {
          id: t.ids.bank,
          organization_id: t.org.id,
          created_by: teacher.id,
          name: 'Bank A',
          visibility: 'group',
        },
        {
          id: t.ids.bank2,
          organization_id: t.org.id,
          created_by: teacher.id,
          name: 'Bank B',
          visibility: 'group',
        },
      ],
      { onConflict: 'id' },
    ),
    db
      .from('quizzes')
      .upsert(
        { id: t.ids.quiz, organization_id: t.org.id, created_by: teacher.id, name: 'Quiz A' },
        { onConflict: 'id' },
      ),
  ]);
  await run([
    db.from('flashcards').upsert(
      [0, 1].flatMap((d) =>
        Array.from({ length: 10 }, (_, i) => ({
          id: uuidv5(`${t.key}:card:${d}:${i}`),
          deck_id: d === 0 ? t.ids.deck : t.ids.deck2,
          organization_id: t.org.id,
          created_by: teacher.id,
          visibility: 'group' as const,
          front: `Card ${d + 1}-${i + 1} front`,
          back: `Card ${d + 1}-${i + 1} back`,
        })),
      ),
      { onConflict: 'id' },
    ),
    db.from('questions').upsert(
      [t.ids.bank, t.ids.bank2].flatMap((bankId, b) =>
        Array.from({ length: 5 }, (_, i) => ({
          id: uuidv5(`${t.key}:q:${b}:${i}`),
          bank_id: bankId,
          organization_id: t.org.id,
          created_by: teacher.id,
          content: `Question ${b + 1}-${i + 1}?`,
          type: (i < 3
            ? 'mcq'
            : i === 3
              ? 'true_false'
              : 'open') as Database['public']['Enums']['question_type'],
          visibility: 'group' as const,
        })),
      ),
      { onConflict: 'id' },
    ),
    db.from('teacher_assignments').upsert(
      {
        id: t.ids.assignment,
        organization_id: t.org.id,
        created_by: teacher.id,
        title: 'Assignment A',
        status: 'published',
        quiz_id: t.ids.quiz,
        question_count: 5,
        total_points: 5,
      },
      { onConflict: 'id' },
    ),
  ]);
  await run([
    db.from('question_options').upsert(
      [0, 1].flatMap((b) =>
        [0, 1, 2].flatMap((i) =>
          Array.from({ length: 4 }, (_, o) => ({
            id: uuidv5(`${t.key}:opt:${b}:${i}:${o}`),
            question_id: uuidv5(`${t.key}:q:${b}:${i}`),
            content: `Option ${o + 1}`,
            is_correct: o === 0,
            order_index: o,
          })),
        ),
      ),
      { onConflict: 'id' },
    ),
    db.from('quiz_questions').upsert(
      Array.from({ length: 5 }, (_, i) => ({
        quiz_id: t.ids.quiz,
        question_id: uuidv5(`${t.key}:q:0:${i}`),
        order_index: i,
        points: 1,
      })),
      { onConflict: 'quiz_id,question_id' },
    ),
    db
      .from('assignment_targets')
      .upsert(
        { id: uuidv5(`${t.key}:target`), assignment_id: t.ids.assignment, group_id: t.ids.group },
        { onConflict: 'id' },
      ),
  ]);
}

/* --------------------------------------------------------------------- reset */

async function reset(): Promise<void> {
  await sql.unsafe(`DELETE FROM public.organizations WHERE name LIKE 'e2e %'`);
  await sql.unsafe(`DELETE FROM auth.users WHERE email LIKE 'e2e+%@test.local'`);
}

/* ---------------------------------------------------------------------- main */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;

  if (args.includes('--reset')) await reset();

  const started = performance.now();
  const tests = only
    ? [
        {
          file: only.split('::')[0],
          title: only.split('::')[1] ?? '',
          project: only.split('::')[2] ?? 'chromium',
        },
      ]
    : await listTests();

  const tenants = [
    ...new Map(
      tests.map((t) => {
        const tenant = buildTenant(t.file, t.title, t.project);
        return [tenant.key, tenant] as const;
      }),
    ).values(),
  ];
  const index: Record<string, Tenant> = {};
  const concurrency = Number(process.env.E2E_SEED_CONCURRENCY ?? 8);

  for (let i = 0; i < tenants.length; i += concurrency) {
    const chunk = tenants.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (t) => {
        await seedTenant(t);
        index[t.key] = t;
      }),
    );
  }

  mkdirSync(SEED_DIR, { recursive: true });
  writeFileSync(INDEX, JSON.stringify(index, null, 0));
  const ms = Math.round(performance.now() - started);
  console.log(`e2e seed: ${tenants.length} tenants in ${ms} ms → ${INDEX}`);
  await sql.close();
}

await main();
