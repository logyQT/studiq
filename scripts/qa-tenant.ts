/**
 * Seed (or reset) one QA case's isolated tenant.
 *
 *   bun scripts/qa-tenant.ts PUB-01
 *   bun scripts/qa-tenant.ts PUB-01 --json
 *   bun scripts/qa-tenant.ts PUB-01 --reset
 *   bun scripts/qa-tenant.ts ONB-04 --profile bare --role manager --fresh
 *   bun scripts/qa-tenant.ts ONB-10 --profile org-limit --fresh
 *   bun scripts/qa-tenant.ts MGR-ROL-02 --plan hub --fresh
 *
 * One command, one tenant, all deterministic from the case id. The spec builds its
 * own decks/banks/quizzes through the API, so nothing shared leaks between cases.
 *
 * `--plan <key>` puts the tenant's own organization on that plan through the same
 * `apply_org_plan` RPC the billing webhook calls, so a case whose prerequisite is
 * a paid entitlement (e.g. `role.builder` on Hub) gets it inside its own tenant
 * instead of depending on the global plan catalogue or another org's purchase.
 *
 * Profiles:
 * - `content` (default) — org + manager/teacher/student + a default group.
 * - `bare` — one staff account with **no organization and no group**, for the
 *   first-run onboarding cases (`ONB-01`, `ONB-04`) whose whole subject is the
 *   setup gate. `--role manager|teacher` picks the account type (default
 *   `teacher`); nothing else is created, so the account cannot accidentally
 *   inherit an org from an earlier seed.
 * - `org-limit` — an organization at capacity minus one (`ONB-10`): an admin, two
 *   teachers and one member (the member limit counts every role), plus two
 *   invitee accounts that are **not** org members, so they accept the pending
 *   invitations through `/app/join`.
 *
 * Every independent run of a first-run case needs a brand-new account: the run
 * itself creates the org. `--fresh` (or an explicit `--run <suffix>`) folds a run
 * suffix into the tenant key, so all derived ids stay deterministic per run
 * without ever reusing an account that has already onboarded.
 *
 * Writes `qa/.tenants/<CASEID>.json` for the spec/fixture to read.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  ensureAccount,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

const ROOT = join(import.meta.dir, '..');
const CASES = join(ROOT, 'qa', 'cases');
const OUT = join(ROOT, 'qa', '.tenants');

const PROFILES = ['content', 'bare', 'org-limit'] as const;
type Profile = (typeof PROFILES)[number];

const args = process.argv.slice(2);

function option(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(`--${name}=`.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const caseId = args.find(
  (arg, index) =>
    !arg.startsWith('--') &&
    !['--profile', '--role', '--run', '--plan'].includes(args[index - 1] ?? ''),
);
const jsonOnly = args.includes('--json');
const reset = args.includes('--reset');
const fresh = args.includes('--fresh');
type ProfileEntry = string | { profile?: string; role?: string; plan?: string };

/**
 * The CI seed contract: `qa/tests/profiles.json` declares the tenant shape a case
 * needs, so a runner can seed every spec without guessing. An explicit
 * `--profile` / `--role` / `--plan` on the command line always wins.
 */
function manifestEntry(caseId: string): ProfileEntry | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'qa', 'tests', 'profiles.json'), 'utf8'),
    ) as Record<string, ProfileEntry>;
    return manifest[caseId];
  } catch {
    return undefined;
  }
}

function declaredProfile(entry: ProfileEntry | undefined): Profile {
  const value = typeof entry === 'string' ? entry : entry?.profile;
  return value === 'bare' || value === 'org-limit' ? value : 'content';
}

function declaredRole(entry: ProfileEntry | undefined): string | undefined {
  return typeof entry === 'string' ? undefined : entry?.role;
}

function declaredPlan(entry: ProfileEntry | undefined): string | undefined {
  return typeof entry === 'string' ? undefined : entry?.plan;
}

const entry = manifestEntry(caseId ?? '');
const profile = (option('profile') ?? declaredProfile(entry)) as Profile;
const role = option('role') ?? declaredRole(entry) ?? 'teacher';
const plan = option('plan') ?? declaredPlan(entry);
const runArg = option('run');

if (!caseId || !/^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(caseId)) {
  console.error(
    'usage: bun scripts/qa-tenant.ts <CASEID> [--profile content|bare|org-limit] [--role teacher|manager|student] [--plan <key>] [--fresh] [--run <suffix>] [--json] [--reset]',
  );
  process.exit(2);
}
if (!PROFILES.includes(profile)) {
  console.error(`unknown profile "${profile}": expected ${PROFILES.join(', ')}`);
  process.exit(2);
}
if (role !== 'teacher' && role !== 'manager' && role !== 'student') {
  console.error(`unknown role "${role}": expected teacher, manager or student`);
  process.exit(2);
}
if (plan && profile === 'bare') {
  // A first-run tenant has no organization yet, so there is nothing to put on a plan.
  console.error('cannot combine --plan with the bare profile (no organization exists yet)');
  process.exit(2);
}
if (plan && !/^[a-z][a-z0-9_]*$/.test(plan)) {
  console.error(`invalid plan "${plan}"`);
  process.exit(2);
}
if (!existsSync(join(CASES, `${caseId}.md`))) {
  console.error(`unknown case ${caseId}: qa/cases/${caseId}.md is missing`);
  process.exit(2);
}

// A run suffix makes each independent run a brand-new tenant; without one the
// key is the stable `<case>::<case>::qa-shared` identity.
const runSuffix = runArg ?? (fresh ? `r${Date.now().toString(36)}${randomTag(4)}` : '');
const title = runSuffix ? `${caseId}#${runSuffix}` : caseId;
const key = tenantKey(`qa/cases/${caseId}.md`, title, 'qa-shared');
const orgId = tenantId(key, 'org');
const groupId = tenantId(key, 'group:default');
const accounts = {
  manager: buildAccount(key, 'manager', 'manager', { name: 'QA manager' }),
  teacher: buildAccount(key, 'teacher', 'educator', { name: 'QA teacher' }),
  teacher2: buildAccount(key, 'teacher2', 'educator', { name: 'QA teacher 2', orgRole: 'teacher' }),
  student: buildAccount(key, 'student', 'student', { name: 'QA student' }),
  invitee1: buildAccount(key, 'invitee1', 'student', { name: 'QA invitee 1' }),
  invitee2: buildAccount(key, 'invitee2', 'student', { name: 'QA invitee 2' }),
};
const bareAccount =
  role === 'manager' ? accounts.manager : role === 'student' ? accounts.student : accounts.teacher;
const all: SeedAccount[] =
  profile === 'bare'
    ? [bareAccount]
    : profile === 'org-limit'
      ? Object.values(accounts)
      : [accounts.manager, accounts.teacher, accounts.student];

// Local convenience: reuse the app's env file when the vars are not exported.
function loadEnv(): void {
  for (const candidate of ['apps/web/.env', '.env']) {
    const path = join(ROOT, candidate);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i <= 0 || line.trim().startsWith('#')) continue;
      const name = line.slice(0, i).trim();
      if (!process.env[name]) process.env[name] = line.slice(i + 1).trim();
    }
    break;
  }
  // QA workers share one app and one Supabase even though each worktree keeps
  // its own `.env`; `qa/env.json` names the shared stack the spec runs against.
  const configPath = join(ROOT, 'qa', 'env.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as { supabaseUrl?: string };
      if (config.supabaseUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = config.supabaseUrl;
    } catch {
      // A malformed qa/env.json should not hide the real seeding error.
    }
  }
}

loadEnv();
const db = createSeedDb();
// The run suffix makes a fresh org name recognisable in the UI; without one the
// name keeps the historical `<case>-<key tail>` shape.
const orgName = `qa-${caseId.toLowerCase()}-${runSuffix || key.slice(-6)}`;

function writeTenant(tenant: Record<string, unknown>): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${caseId}.json`), JSON.stringify(tenant, null, 2));

  if (jsonOnly) {
    console.log(JSON.stringify(tenant, null, 2));
    return;
  }

  console.log(
    `qa tenant ${caseId} (${profile}${profile === 'bare' ? `/${role}` : ''}${runSuffix ? `, run ${runSuffix}` : ''})`,
  );
  if (tenant.org) {
    const org = tenant.org as { id: string; name: string };
    console.log(`  org      ${org.id}  ${org.name}`);
  } else {
    console.log(`  org      none (first-run ${role})`);
  }
  if (tenant.plan) console.log(`  plan     ${String(tenant.plan)}`);
  for (const [name, user] of Object.entries(
    tenant.users as Record<string, { email: string; password: string }>,
  )) {
    console.log(`  ${name.padEnd(8)} ${user.email} / ${user.password}`);
  }
  if (tenant.group) {
    const group = tenant.group as { id: string; name: string };
    console.log(`  group    ${group.id}  ${group.name}`);
  }
  console.log(`  file     qa/.tenants/${caseId}.json`);
}

if (reset) {
  if (profile === 'bare') {
    // The account may have created an org through the UI on a previous run;
    // deleting that org cascades its memberships/groups so the next seed is a
    // first-run account again.
    const { data: memberships } = await db
      .from('org_members')
      .select('organization_id')
      .eq('user_id', bareAccount.id);
    for (const membership of memberships ?? []) {
      await db.from('organizations').delete().eq('id', membership.organization_id);
    }
    await db.auth.admin.deleteUser(bareAccount.id).catch(() => undefined);
  } else {
    await db.from('organizations').delete().eq('id', orgId);
    for (const account of all) {
      if (account.id) await db.auth.admin.deleteUser(account.id).catch(() => undefined);
    }
  }
  if (!jsonOnly) console.log(`qa tenant ${caseId}: reset (${profile})`);
  process.exit(0);
}

if (profile === 'bare') {
  // The account must exist before the membership sweep (FK), so create first and
  // then guarantee it belongs to no organization.
  const seeded = await seedTenantGraph(db, {
    key,
    org: null,
    defaultGroup: null,
    extraGroups: [],
    owner: bareAccount,
    members: [],
    ownerOrgRole: 'member',
  });
  await db.from('org_members').delete().eq('user_id', seeded.owner.id);

  writeTenant({
    case: caseId,
    profile,
    role,
    runSuffix: runSuffix || null,
    key,
    org: null,
    group: null,
    users: {
      [role]: {
        id: seeded.owner.id,
        email: seeded.owner.email,
        password: seeded.owner.password,
      },
    },
  });
  process.exit(0);
}

// Accounts that exist outside the org graph still go through the same seeder.
const ensured: Partial<Record<'invitee1' | 'invitee2', SeedAccount>> = {};
if (profile === 'org-limit') {
  ensured.invitee1 = await ensureAccount(db, accounts.invitee1);
  ensured.invitee2 = await ensureAccount(db, accounts.invitee2);
}

const seeded = await seedTenantGraph(db, {
  key,
  org: { id: orgId, name: orgName },
  defaultGroup: { id: groupId, name: 'G1', isDefault: true },
  extraGroups: [],
  owner: accounts.manager,
  members:
    profile === 'org-limit'
      ? [
          // Real org roles: the member-limit counter includes the admin and the
          // teachers, so the fixture must have one of each.
          { ...accounts.teacher, orgRole: 'teacher' as const },
          accounts.teacher2,
          accounts.student,
        ]
      : [accounts.teacher, accounts.student],
  ownerOrgRole: 'admin',
});

// A paid entitlement is part of the case's prerequisite, not a global plan
// change: the RPC only touches this tenant's own organization (plan, role-feature
// snapshot, limits) and is the same one `MockStripeService` calls after purchase.
if (plan) {
  const { error } = await db.rpc('apply_org_plan', { p_org_id: orgId, p_plan: plan });
  if (error) throw new Error(`seed ${caseId}: apply_org_plan(${plan}) ${error.message}`);
}

const users: Record<string, { id: string; email: string; password: string }> = {
  manager: { id: seeded.owner.id, email: seeded.owner.email, password: seeded.owner.password },
  teacher: {
    id: seeded.members[0].id,
    email: seeded.members[0].email,
    password: seeded.members[0].password,
  },
  student: {
    id: seeded.members[profile === 'org-limit' ? 2 : 1].id,
    email: seeded.members[profile === 'org-limit' ? 2 : 1].email,
    password: seeded.members[profile === 'org-limit' ? 2 : 1].password,
  },
};
if (profile === 'org-limit') {
  users.teacher2 = {
    id: seeded.members[1].id,
    email: seeded.members[1].email,
    password: seeded.members[1].password,
  };
  for (const inviteeRole of ['invitee1', 'invitee2'] as const) {
    const account = ensured[inviteeRole]!;
    users[inviteeRole] = { id: account.id, email: account.email, password: account.password };
  }
}

writeTenant({
  case: caseId,
  profile,
  runSuffix: runSuffix || null,
  key,
  org: { id: seeded.orgId, name: orgName },
  plan: plan ?? null,
  users,
  group: { id: seeded.defaultGroupId, name: 'G1' },
});
