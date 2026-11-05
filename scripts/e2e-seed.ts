/**
 * e2e seeder — materialises one isolated tenant per test (file × title × browser)
 * before the suite starts, so every spec owns its org, users and content.
 *
 * Design notes:
 * - Auth users go in as one SQL statement per tenant (`createSqlAccountWriter`),
 *   the way `supabase/seeds/01_users.sql` did: GoTrue bcrypts every password it
 *   creates, and with a shared test password the batch only needs one hash. The
 *   writer also writes the `auth.identities` row GoTrue would have written.
 * - Domain rows go through the service-role client, typed against the generated
 *   `Database` type, so a schema change breaks this file at compile time.
 * - Every id is a uuidv5 of `<tenant>:<entity>`, so a test can address its rows
 *   without a query and a failing run reproduces the same ids.
 *
 * Usage:
 *   bun scripts/e2e-seed.ts                     # seed everything the suite runs
 *   bun scripts/e2e-seed.ts --reset             # drop e2e tenants first
 *   bun scripts/e2e-seed.ts --project chromium  # one CI leg (its own tenants only)
 *   bun scripts/e2e-seed.ts --only <key>
 *
 * In CI the seeder runs as its own workflow step (one per browser leg) and
 * Playwright then starts with `E2E_SKIP_SEED=1`; locally `global-setup.ts` still
 * runs it so `bunx playwright test` works with no extra step.
 */
import { isRecord, readString } from '@studiq/server/lib/record';
import { SQL } from 'bun';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shortHash, tenantKey, uuidv5 } from '#test/e2e/fixtures/ids';
import { profileFor } from '#test/e2e/fixtures/profiles';
import {
  buildAccount,
  concurrencyFromEnv,
  createSeedDb,
  createSqlAccountWriter,
  runBounded,
  seedTenantGraph,
  tenantId,
  type AccountWriter,
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
    topic: string;
    card: string;
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
  if (process.env[name]) return process.env[name];
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

// No port fallbacks on purpose: a checkout can run on any port block, and a
// silent fallback would seed another checkout's database. `bun dev:up` renders
// apps/web/.env (and loads SUPABASE_DB_URL above), so a local run just works.
const DB_URL = env('SUPABASE_DB_URL');
const SUPABASE_URL = env('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

const sql = new SQL(DB_URL);
const db = createSeedDb({ url: SUPABASE_URL, serviceKey: SERVICE_KEY });
const writeAccounts: AccountWriter = createSqlAccountWriter(sql);

/* ------------------------------------------------------------------ manifest */

function isTenant(value: unknown): value is Tenant {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === 'string' &&
    typeof value.file === 'string' &&
    typeof value.title === 'string' &&
    typeof value.project === 'string' &&
    typeof value.profile === 'string' &&
    isRecord(value.org) &&
    typeof value.org.id === 'string' &&
    isRecord(value.users) &&
    isRecord(value.ids)
  );
}

async function listTests(): Promise<Array<{ file: string; title: string; project: string }>> {
  const proc = Bun.spawn(['bunx', 'playwright', 'test', '--list', '--reporter=json'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  const parsed: unknown = JSON.parse(out);
  const found: Array<{ file: string; title: string; project: string }> = [];

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (!isRecord(value)) return;

    const file = readString(value, 'file') ?? '';
    const specs = value.specs;
    if (Array.isArray(specs)) {
      for (const spec of specs) {
        if (!isRecord(spec)) continue;
        const title = readString(spec, 'title') ?? '';
        const tests = spec.tests;
        if (!Array.isArray(tests)) continue;
        for (const test of tests) {
          if (!isRecord(test)) continue;
          const project = readString(test, 'projectName');
          if (project) found.push({ file, title, project });
        }
      }
    }

    walk(value.suites);
  };

  walk(parsed);
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
      topic: tenantId(key, 'topic'),
      card: tenantId(key, 'card:0:0'),
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

  await seedTenantGraph(
    db,
    {
      key: t.key,
      org: t.org,
      defaultGroup: { id: t.ids.group, name: 'G1', isDefault: false },
      extraGroups: [],
      owner: teacher,
      members: [student],
      ownerOrgRole: 'teacher',
    },
    writeAccounts,
  );

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
    db.from('topics').upsert(
      {
        id: t.ids.topic,
        organization_id: t.org.id,
        created_by: teacher.id,
        name: 'Topic A',
        visibility: 'group',
      },
      { onConflict: 'id' },
    ),
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
    db.from('deck_groups').upsert(
      [t.ids.deck, t.ids.deck2].map((deckId) => ({ deck_id: deckId, group_id: t.ids.group })),
      { onConflict: 'deck_id,group_id' },
    ),
    db.from('bank_groups').upsert(
      [t.ids.bank, t.ids.bank2].map((bankId) => ({ bank_id: bankId, group_id: t.ids.group })),
      { onConflict: 'bank_id,group_id' },
    ),
    db
      .from('topic_groups')
      .upsert(
        { topic_id: t.ids.topic, group_id: t.ids.group },
        { onConflict: 'topic_id,group_id' },
      ),
    db.from('flashcards').upsert(
      [0, 1].flatMap((d) =>
        Array.from({ length: 10 }, (_, i) => ({
          id: uuidv5(`${t.key}:card:${d}:${i}`),
          deck_id: d === 0 ? t.ids.deck : t.ids.deck2,
          organization_id: t.org.id,
          created_by: teacher.id,
          front: `Card ${d + 1}-${i + 1} front`,
          back: `Card ${d + 1}-${i + 1} back`,
          visibility: 'group' as const,
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
          type: i < 3 ? 'mcq' : i === 3 ? 'true_false' : 'open',
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
    db.from('question_topic_assignments').upsert(
      [0, 1].flatMap((b) =>
        [0, 1, 2, 3, 4].map((i) => ({
          question_id: uuidv5(`${t.key}:q:${b}:${i}`),
          topic_id: t.ids.topic,
        })),
      ),
      { onConflict: 'question_id,topic_id' },
    ),
    db.from('flashcard_topic_assignments').upsert(
      Array.from({ length: 10 }, (_, i) => ({
        flashcard_id: uuidv5(`${t.key}:card:0:${i}`),
        topic_id: t.ids.topic,
      })),
      { onConflict: 'flashcard_id,topic_id' },
    ),
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

/** `--name value` or `--name=value`; `undefined` when the flag is absent. */
function option(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(`--${name}=`.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
  // A browser leg seeds only its own tenants: keys include the project, and each
  // leg has its own Supabase instance, so the other project's tenants would be
  // pure waste (~135 orgs and ~270 users).
  const projectFlag = args.some((arg) => arg === '--project' || arg.startsWith('--project='));
  const project = option(args, 'project');
  // Without a value `--project` would fall through to "no filter" and seed every
  // project — after `--reset` has already deleted the tenants.
  if (projectFlag && !project?.trim()) {
    throw new Error('--project needs a project name (e.g. --project chromium)');
  }

  const wipe = args.includes('--reset');

  const tests = only
    ? [
        {
          file: only.split('::')[0],
          title: only.split('::')[1] ?? '',
          project: only.split('::')[2] ?? 'chromium',
        },
      ]
    : await listTests();

  const scoped = project ? tests.filter((test) => test.project === project) : tests;
  if (project && scoped.length === 0) {
    throw new Error(
      `--project ${project} matched no tests (is it a project name in playwright.config.ts?)`,
    );
  }

  // Only after the request is known to be valid: `--reset` deletes every e2e
  // tenant, so a typo in `--project` must fail before anything is destroyed.
  if (wipe) await reset();

  const started = performance.now();
  const tenants = [
    ...new Map(
      scoped.map((t) => {
        const tenant = buildTenant(t.file, t.title, t.project);
        return [tenant.key, tenant] as const;
      }),
    ).values(),
  ];
  // A per-project run owns only its own tenants: keep the other projects'
  // manifest entries so seeding one leg does not hide the other leg's tenants
  // from a later `--project` run. The selected project is always rebuilt from
  // this run's test list. `--reset` wipes every e2e tenant, so the manifest
  // starts empty there — entries for the other project would point at deleted
  // rows.
  const index: Record<string, Tenant> = {};
  if (project && !wipe) {
    try {
      const previous: unknown = JSON.parse(readFileSync(INDEX, 'utf8'));
      if (isRecord(previous)) {
        for (const [key, tenant] of Object.entries(previous)) {
          if (isTenant(tenant) && tenant.project !== project) index[key] = tenant;
        }
      }
    } catch {
      // No manifest yet (or unreadable) — nothing to preserve.
    }
  }

  await runBounded(tenants, concurrencyFromEnv('E2E_SEED_CONCURRENCY'), async (t) => {
    await seedTenant(t);
    index[t.key] = t;
  });

  mkdirSync(SEED_DIR, { recursive: true });
  writeFileSync(INDEX, JSON.stringify(index, null, 0));
  const ms = Math.round(performance.now() - started);
  console.log(`e2e seed: ${tenants.length} tenants in ${ms} ms → ${INDEX}`);
  await sql.close();
}

await main();
