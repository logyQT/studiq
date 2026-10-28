/**
 * Seed (or reset) one QA case's isolated tenant.
 *
 *   bun scripts/qa-tenant.ts PUB-01
 *   bun scripts/qa-tenant.ts PUB-01 --json
 *   bun scripts/qa-tenant.ts PUB-01 --reset
 *   bun scripts/qa-tenant.ts ONB-01 --profile bare
 *
 * One command, one tenant, all deterministic from the case id. The spec builds its
 * own decks/banks/quizzes through the API, so nothing shared leaks between cases.
 *
 * Profiles:
 * - `content` (default) — org + manager/teacher/student + a default group.
 * - `bare` — a single educator with **no organization and no group**, for the
 *   first-run onboarding cases (`ONB-01`) whose whole subject is the `/setup`
 *   gate. Nothing else is created, so the account cannot accidentally inherit an
 *   org from an earlier seed.
 *
 * Writes `qa/.tenants/<CASEID>.json` for the spec/fixture to read.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

const ROOT = join(import.meta.dir, '..');
const CASES = join(ROOT, 'qa', 'cases');
const OUT = join(ROOT, 'qa', '.tenants');

const args = process.argv.slice(2);
const caseId = args.find((a) => !a.startsWith('--') && a !== profileArg());
const jsonOnly = args.includes('--json');
const reset = args.includes('--reset');

function profileArg(): string | undefined {
  const inline = args.find((a) => a.startsWith('--profile='));
  if (inline) return inline.slice('--profile='.length);
  const index = args.indexOf('--profile');
  return index >= 0 ? args[index + 1] : undefined;
}

const profile = (profileArg() ?? 'content') as 'bare' | 'content';

if (!caseId || !/^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(caseId)) {
  console.error(
    'usage: bun scripts/qa-tenant.ts <CASEID> [--profile bare|content] [--json] [--reset]',
  );
  process.exit(2);
}
if (profile !== 'bare' && profile !== 'content') {
  console.error(`unknown profile ${profile}: use bare or content`);
  process.exit(2);
}
if (!existsSync(join(CASES, `${caseId}.md`))) {
  console.error(`unknown case ${caseId}: qa/cases/${caseId}.md is missing`);
  process.exit(2);
}

const key = tenantKey(`qa/cases/${caseId}.md`, caseId, 'qa-shared');
const orgId = tenantId(key, 'org');
const groupId = tenantId(key, 'group:default');
const accounts = {
  manager: buildAccount(key, 'manager', 'manager', { name: 'QA manager' }),
  teacher: buildAccount(key, 'teacher', 'educator', { name: 'QA teacher' }),
  student: buildAccount(key, 'student', 'student', { name: 'QA student' }),
};
const all: SeedAccount[] =
  profile === 'bare' ? [accounts.teacher] : [accounts.manager, accounts.teacher, accounts.student];

// Local convenience: reuse the app's env file when the vars are not exported.
function loadEnv(): void {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  for (const candidate of ['apps/web/.env', '.env']) {
    const path = join(ROOT, candidate);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i <= 0 || line.trim().startsWith('#')) continue;
      const name = line.slice(0, i).trim();
      if (!process.env[name]) process.env[name] = line.slice(i + 1).trim();
    }
    return;
  }
}

loadEnv();
const db = createSeedDb();
const orgName = `qa-${caseId.toLowerCase()}-${key.slice(-6)}`;

if (reset) {
  if (profile === 'content') await db.from('organizations').delete().eq('id', orgId);
  // A bare tenant is defined by *not* being in an org: clear a membership left
  // behind by an earlier `content` seed with the same case key.
  if (profile === 'bare') await db.from('org_members').delete().eq('user_id', accounts.teacher.id);
  for (const account of all) {
    if (account.id) await db.auth.admin.deleteUser(account.id).catch(() => undefined);
  }
  if (!jsonOnly) console.log(`qa tenant ${caseId}: reset (${profile})`);
  process.exit(0);
}

if (profile === 'bare') {
  // The account must exist before the membership sweep (FK), so create first and
  // then guarantee it belongs to no organization.
  await seedTenantGraph(db, {
    key,
    org: null,
    defaultGroup: null,
    extraGroups: [],
    owner: accounts.teacher,
    members: [],
    ownerOrgRole: 'admin',
  });
  await db.from('org_members').delete().eq('user_id', accounts.teacher.id);

  const bareTenant = {
    case: caseId,
    key,
    profile,
    org: null,
    group: null,
    users: {
      teacher: {
        id: accounts.teacher.id,
        email: accounts.teacher.email,
        password: accounts.teacher.password,
      },
    },
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${caseId}.json`), JSON.stringify(bareTenant, null, 2));

  if (jsonOnly) {
    console.log(JSON.stringify(bareTenant, null, 2));
  } else {
    console.log(`qa tenant ${caseId} (bare — no organization)`);
    console.log(
      `  teacher  ${bareTenant.users.teacher.email} / ${bareTenant.users.teacher.password}`,
    );
    console.log(`  file     qa/.tenants/${caseId}.json`);
  }
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

const tenant = {
  case: caseId,
  key,
  profile,
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
};

mkdirSync(OUT, { recursive: true });
const file = join(OUT, `${caseId}.json`);
writeFileSync(file, JSON.stringify(tenant, null, 2));

if (jsonOnly) {
  console.log(JSON.stringify(tenant, null, 2));
} else {
  console.log(`qa tenant ${caseId}`);
  console.log(`  org      ${tenant.org.id}  ${tenant.org.name}`);
  console.log(`  manager  ${tenant.users.manager.email} / ${tenant.users.manager.password}`);
  console.log(`  teacher  ${tenant.users.teacher.email} / ${tenant.users.teacher.password}`);
  console.log(`  student  ${tenant.users.student.email} / ${tenant.users.student.password}`);
  console.log(`  group    ${tenant.group.id}  ${tenant.group.name}`);
  console.log(`  file     qa/.tenants/${caseId}.json`);
}
