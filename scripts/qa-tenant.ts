/**
 * Seed (or reset) one QA case's isolated tenant.
 *
 *   bun scripts/qa-tenant.ts PUB-01
 *   bun scripts/qa-tenant.ts PUB-01 --json
 *   bun scripts/qa-tenant.ts PUB-01 --reset
 *   bun scripts/qa-tenant.ts ONB-02 --profile bare --fresh
 *
 * One command, one tenant: org + manager/teacher/student + a default group, all
 * deterministic from the case id. The spec builds its own decks/banks/quizzes
 * through the API, so nothing shared leaks between cases.
 *
 * `--profile bare` seeds a single educator with **no organization** (the ONB
 * first-run state). The pair `--profile bare --fresh` takes a fresh run suffix,
 * so every independent run starts from a teacher who has never onboarded; the
 * suffix is part of the deterministic `tenantKey`, never a random UUID.
 *
 * Writes `qa/.tenants/<CASEID>.json` for the spec/fixture to read.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

const ROOT = join(import.meta.dir, '..');
const CASES = join(ROOT, 'qa', 'cases');
const OUT = join(ROOT, 'qa', '.tenants');

const args = process.argv.slice(2);

/** Value of `--name <value>`; the value itself must never be read as the case id. */
function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const caseId = args.find(
  (arg, index) => !arg.startsWith('--') && !['--profile', '--run'].includes(args[index - 1] ?? ''),
);
const jsonOnly = args.includes('--json');
const reset = args.includes('--reset');
const fresh = args.includes('--fresh');
const profile = option('profile') ?? 'content';
const runArg = option('run');

if (!caseId || !/^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(caseId)) {
  console.error(
    'usage: bun scripts/qa-tenant.ts <CASEID> [--json] [--reset] [--profile content|bare] [--fresh] [--run <suffix>]',
  );
  process.exit(2);
}
if (profile !== 'content' && profile !== 'bare') {
  console.error(`unknown profile "${profile}": expected content or bare`);
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
  student: buildAccount(key, 'student', 'student', { name: 'QA student' }),
};
const all: SeedAccount[] = [accounts.manager, accounts.teacher, accounts.student];

// Local convenience: reuse the app's env file when the vars are not exported.
// (Bun also auto-loads `.env`, which is why the shared-URL override below is
// not conditional on the variables being unset.)
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
const orgName = `qa-${caseId.toLowerCase()}-${key.slice(-6)}`;

function writeTenant(tenant: Record<string, unknown>): void {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${caseId}.json`);
  writeFileSync(file, JSON.stringify(tenant, null, 2));
  if (jsonOnly) {
    console.log(JSON.stringify(tenant, null, 2));
    return;
  }
  console.log(`qa tenant ${caseId} (${profile}${runSuffix ? `, run ${runSuffix}` : ''})`);
  if (tenant.org) {
    const org = tenant.org as { id: string; name: string };
    console.log(`  org      ${org.id}  ${org.name}`);
  } else {
    console.log('  org      none (fresh first-run teacher)');
  }
  for (const [role, user] of Object.entries(
    tenant.users as Record<string, { email: string; password: string }>,
  )) {
    console.log(`  ${role.padEnd(8)} ${user.email} / ${user.password}`);
  }
  if (tenant.group) {
    const group = tenant.group as { id: string; name: string };
    console.log(`  group    ${group.id}  ${group.name}`);
  }
  console.log(`  file     qa/.tenants/${caseId}.json`);
}

if (reset) {
  if (profile === 'bare') {
    // The teacher may have created an org through the UI on a previous run;
    // deleting that org cascades its memberships/groups so the next seed is a
    // first-run teacher again.
    const { data: memberships } = await db
      .from('org_members')
      .select('organization_id')
      .eq('user_id', accounts.teacher.id);
    for (const membership of memberships ?? []) {
      await db.from('organizations').delete().eq('id', membership.organization_id);
    }
    await db.auth.admin.deleteUser(accounts.teacher.id).catch(() => undefined);
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
  const seeded = await seedTenantGraph(db, {
    key,
    org: null,
    defaultGroup: null,
    extraGroups: [],
    owner: accounts.teacher,
    members: [],
    ownerOrgRole: 'member',
  });

  writeTenant({
    case: caseId,
    profile,
    runSuffix: runSuffix || null,
    key,
    org: null,
    group: null,
    users: {
      teacher: {
        id: seeded.owner.id,
        email: seeded.owner.email,
        password: seeded.owner.password,
      },
    },
  });
  process.exit(0);
}

const seeded = await seedTenantGraph(db, {
  key,
  org: { id: orgId, name: orgName },
  defaultGroup: { id: groupId, name: 'G1', isDefault: true },
  extraGroups: [],
  owner: accounts.manager,
  members: [accounts.teacher, accounts.student],
  ownerOrgRole: 'admin',
});

writeTenant({
  case: caseId,
  profile,
  runSuffix: runSuffix || null,
  key,
  org: { id: seeded.orgId, name: orgName },
  users: {
    manager: { id: seeded.owner.id, email: seeded.owner.email, password: seeded.owner.password },
    teacher: {
      id: seeded.members[0].id,
      email: seeded.members[0].email,
      password: seeded.members[0].password,
    },
    student: {
      id: seeded.members[1].id,
      email: seeded.members[1].email,
      password: seeded.members[1].password,
    },
  },
  group: { id: seeded.defaultGroupId, name: 'G1' },
});
