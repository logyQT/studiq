/**
 * Demo seeder, plan — applies the two marketing demo tenants.
 *
 * The data lives in SQL (`supabase/seeds/demo/demo-{en,pl}.sql`) because each
 * tenant is one dense, self-contained graph: 11 accounts, 5 decks, 3 banks,
 * 4 quizzes, 3 assignments, seats and eight weeks of study history. Both files
 * are deliberately nested one level below `supabase/seeds/` so `db reset` and
 * CI never replay them — see the header of each SQL file.
 *
 * Two tenants, not one: the UI chrome is translated by `next-intl` while the
 * study material is data, so `apps/web/public/marketing/{locale}/` can only
 * show a coherent language if each locale has its own tenant.
 *
 *   bun scripts/demo-seed.ts              # apply both tenants (idempotent)
 *   bun scripts/demo-seed.ts --locale pl  # apply one tenant
 *   bun scripts/demo-seed.ts --reset      # remove the selected tenant(s)
 *   bun scripts/demo-seed.ts --json       # machine-readable summary
 *
 * Like `scripts/qa-tenant.ts`, the plan is separated from the thin entrypoint
 * (`scripts/demo-seed.ts`): flags, exit codes and output style live here.
 *
 * `SUPABASE_DB_URL` comes from the process environment when set; otherwise the
 * script reads it from `bunx supabase status --env` for this checkout's stack,
 * and falls back to root `.env.local`. Nothing is printed about the connection.
 */
import { SQL } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDbUrl, fail, finish, flag, option, printBlock, printJson } from './cli';

const ROOT = join(import.meta.dir, '..', '..');
const SEED_DIR = join(ROOT, 'supabase/seeds/demo');
const PASSWORD = 'Seed4Test!';

interface Tenant {
  locale: string;
  file: string;
  org: string;
  orgId: string;
  logins: { role: string; email: string }[];
}

/**
 * The two tenants. `orgId` mirrors the fixed block at the top of each SQL file
 * (`d0000000-…` for English, `e0000000-…` for Polish); the summary uses it to
 * count that tenant's rows without depending on the seed's helper function.
 */
const TENANTS: Tenant[] = [
  {
    locale: 'en',
    file: 'demo-en.sql',
    org: 'Northfield University',
    orgId: 'd0000000-0000-4000-8000-000000000001',
    logins: [
      { role: 'manager', email: 'michael.brown@example.edu' },
      { role: 'educator', email: 'emily.carter@example.edu' },
      { role: 'educator', email: 'daniel.weber@example.edu' },
      { role: 'student', email: 'alice.jones@example.edu' },
      { role: 'student', email: 'john.smith@example.edu' },
      { role: 'student', email: 'jane.doe@example.edu' },
      { role: 'student', email: 'omar.haddad@example.edu' },
      { role: 'student', email: 'sofia.rossi@example.edu' },
      { role: 'student', email: 'liam.oconnor@example.edu' },
      { role: 'student', email: 'yuki.tanaka@example.edu' },
      { role: 'student', email: 'priya.patel@example.edu' },
    ],
  },
  {
    locale: 'pl',
    file: 'demo-pl.sql',
    org: 'Uniwersytet Medyczny w Krakowie',
    orgId: 'e0000000-0000-4000-8000-000000000001',
    logins: [
      { role: 'manager', email: 'marek.wisniewski@example.edu' },
      { role: 'educator', email: 'anna.kowalska@example.edu' },
      { role: 'educator', email: 'piotr.lewandowski@example.edu' },
      { role: 'student', email: 'zofia.nowak@example.edu' },
      { role: 'student', email: 'jan.kaczmarek@example.edu' },
      { role: 'student', email: 'aleksandra.wojcik@example.edu' },
      { role: 'student', email: 'michal.kaminski@example.edu' },
      { role: 'student', email: 'natalia.lewandowska@example.edu' },
      { role: 'student', email: 'tomasz.zielinski@example.edu' },
      { role: 'student', email: 'karolina.szymanska@example.edu' },
      { role: 'student', email: 'pawel.dabrowski@example.edu' },
    ],
  },
];

const USAGE = 'usage: bun scripts/demo-seed.ts [--locale en|pl] [--reset] [--json]';

/** `cli.ts` owns discovery; the seeder owns what to do when there is nothing. */
async function requireDbUrl(): Promise<string> {
  const url = await resolveDbUrl(ROOT);
  if (!url) {
    return fail(
      'missing SUPABASE_DB_URL: start this checkout’s stack (`bun run env:ensure --profile db`) ' +
        'or export SUPABASE_DB_URL before seeding',
    );
  }
  return url;
}

interface TenantSummary {
  locale: string;
  org: string;
  orgId: string;
  members: number;
  managers: number;
  educators: number;
  students: number;
  groups: number;
  topics: number;
  decks: number;
  cards: number;
  banks: number;
  questions: number;
  quizzes: number;
  assignments: number;
  reviews: number;
  reviewDays: number;
  attempts: number;
  submissionRows: number;
  seatsUsed: number;
  seatsTotal: number;
  logins: { role: string; email: string }[];
}

/**
 * The counters as the summary query returns them: `TenantSummary` minus the
 * tenant identity, so the field list is declared once. The SELECT aliases quote
 * these camelCase names because Postgres would otherwise fold them to lowercase.
 */
type Counts = Omit<TenantSummary, 'locale' | 'org' | 'orgId' | 'logins'>;

async function summarise(sql: SQL, tenant: Tenant): Promise<TenantSummary> {
  const org = tenant.orgId;
  const rows = await sql`
    SELECT
      (SELECT count(*) FROM public.org_members WHERE organization_id = ${org})::int AS members,
      (SELECT count(*) FROM public.org_members m JOIN public.org_roles r ON r.id = m.org_role_id
        WHERE m.organization_id = ${org} AND r.name = 'admin')::int AS managers,
      (SELECT count(*) FROM public.org_members m JOIN public.org_roles r ON r.id = m.org_role_id
        WHERE m.organization_id = ${org} AND r.name = 'teacher')::int AS educators,
      (SELECT count(*) FROM public.org_members m JOIN public.org_roles r ON r.id = m.org_role_id
        WHERE m.organization_id = ${org} AND r.name = 'member')::int AS students,
      (SELECT count(*) FROM public.groups WHERE organization_id = ${org})::int AS groups,
      (SELECT count(*) FROM public.topics WHERE organization_id = ${org})::int AS topics,
      (SELECT count(*) FROM public.flashcard_decks WHERE organization_id = ${org})::int AS decks,
      (SELECT count(*) FROM public.flashcards WHERE organization_id = ${org})::int AS cards,
      (SELECT count(*) FROM public.question_banks WHERE organization_id = ${org})::int AS banks,
      (SELECT count(*) FROM public.questions WHERE organization_id = ${org})::int AS questions,
      (SELECT count(*) FROM public.quizzes WHERE organization_id = ${org})::int AS quizzes,
      (SELECT count(*) FROM public.teacher_assignments WHERE organization_id = ${org})::int AS assignments,
      (SELECT count(*) FROM public.flashcard_practice WHERE organization_id = ${org})::int AS reviews,
      (SELECT count(DISTINCT date_trunc('day', practiced_at))
        FROM public.flashcard_practice WHERE organization_id = ${org})::int AS "reviewDays",
      (SELECT count(*) FROM public.quiz_attempts WHERE organization_id = ${org})::int AS attempts,
      (SELECT count(*) FROM public.quiz_attempts
        WHERE organization_id = ${org} AND assignment_id IS NOT NULL)::int AS "submissionRows",
      (SELECT count(*) FROM public.org_seat_assignments WHERE organization_id = ${org})::int AS "seatsUsed",
      (SELECT COALESCE(sum(total), 0) FROM public.org_seat_pools WHERE organization_id = ${org})::int AS "seatsTotal"
  `;
  const row = rows[0] as Counts;
  return {
    locale: tenant.locale,
    org: tenant.org,
    orgId: tenant.orgId,
    ...row,
    logins: tenant.logins,
  };
}

function summaryBlock(s: TenantSummary): string[] {
  return [
    `demo-${s.locale}: ${s.org} (plan campus)`,
    `  org         ${s.orgId}`,
    `  people      ${s.members} (${s.managers} manager, ${s.educators} educators, ${s.students} students)`,
    `  groups      ${s.groups}   topics ${s.topics}`,
    `  content     ${s.decks} decks / ${s.cards} cards, ${s.banks} banks / ${s.questions} questions, ${s.quizzes} quizzes`,
    `  assignments ${s.assignments}`,
    `  history     ${s.reviews} reviews over ${s.reviewDays} days, ${s.attempts} quiz attempts (${s.submissionRows} assignment submissions)`,
    `  seats       ${s.seatsUsed} of ${s.seatsTotal} assigned`,
    '  logins',
    ...s.logins.map((login) => `    ${login.role.padEnd(9)} ${login.email} / ${PASSWORD}`),
  ];
}

function selected(args: string[]): Tenant[] {
  const locale = option(args, 'locale');
  if (!locale) return TENANTS;
  const tenant = TENANTS.find((t) => t.locale === locale);
  if (!tenant) {
    fail(`unknown --locale "${locale}": expected ${TENANTS.map((t) => t.locale).join(' or ')}`);
  }
  return [tenant];
}

/** Apply (or reset) the demo tenants. */
export async function runDemoSeed(): Promise<void> {
  const args = process.argv.slice(2);
  if (flag(args, 'help')) {
    console.log(USAGE);
    await finish(undefined, 0);
  }
  const jsonOnly = flag(args, 'json');
  const resetOnly = flag(args, 'reset');
  const stray = args.filter(
    (arg, index) =>
      !['--reset', '--json', '--help'].includes(arg) &&
      !arg.startsWith('--locale') &&
      args[index - 1] !== '--locale',
  );
  if (stray.length > 0) {
    fail(`${USAGE}\nunknown argument(s): ${stray.join(' ')}`);
  }

  const tenants = selected(args);
  const sql = new SQL(await requireDbUrl(), { max: 1 });
  try {
    if (resetOnly) {
      for (const tenant of tenants) {
        await sql`DELETE FROM public.organizations WHERE id = ${tenant.orgId}`;
        await sql`DELETE FROM auth.users WHERE email IN ${sql(tenant.logins.map((l) => l.email))}`;
      }
      if (jsonOnly) {
        printJson({ reset: tenants.map((t) => ({ locale: t.locale, orgId: t.orgId })) });
      } else {
        printBlock(tenants.map((tenant) => `demo-${tenant.locale}: reset (${tenant.org})`));
      }
      await finish(sql, 0);
    }

    // One file per tenant: applying both in one transaction would roll the
    // English tenant back if the Polish one failed.
    for (const tenant of tenants) {
      await sql.unsafe(readFileSync(join(SEED_DIR, tenant.file), 'utf8'));
    }

    const summaries: TenantSummary[] = [];
    for (const tenant of tenants) summaries.push(await summarise(sql, tenant));

    if (jsonOnly) {
      printJson({ password: PASSWORD, tenants: summaries });
      await finish(sql, 0);
    }

    for (const summary of summaries) printBlock(summaryBlock(summary));
  } catch (error) {
    console.error(`demo seed failed: ${(error as Error).message}`);
    await finish(sql, 2);
  }
  await finish(sql, 0);
}
