/**
 * Seed (or reset) QA case tenants.
 *
 * One case (local work, one worker):
 *
 *   bun scripts/qa-tenant.ts PUB-01
 *   bun scripts/qa-tenant.ts PUB-01 --json
 *   bun scripts/qa-tenant.ts PUB-01 --reset
 *   bun scripts/qa-tenant.ts ONB-04 --profile bare --role manager --fresh
 *   bun scripts/qa-tenant.ts ONB-10 --profile org-limit --fresh
 *   bun scripts/qa-tenant.ts MGR-ROL-02 --plan hub --fresh
 *
 * Every case in one process (CI, before the suite starts — the same shape as
 * `scripts/e2e-seed.ts`, so seeding never runs while the suite is loading the app):
 *
 *   bun scripts/qa-tenant.ts --all --run "ci$GITHUB_RUN_ID"
 *
 * All ids are deterministic from the case id. The spec builds its own
 * decks/banks/quizzes through the API, so nothing shared leaks between cases.
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
 * - `two-org` — one manager who administers two organizations (`MGR-03`), with
 *   different member counts (3 vs 2, one teacher vs none), two groups each and one
 *   pending invitation each. Seeded up front like every other profile so the spec
 *   never seeds while the suite is running.
 *
 * Every independent run of a first-run case needs a brand-new account: the run
 * itself creates the org. `--fresh` (or an explicit `--run <suffix>`) folds a run
 * suffix into the tenant key, so all derived ids stay deterministic per run
 * without ever reusing an account that has already onboarded. `--all` takes one
 * shared suffix for the whole batch, so a suite run seeds once and every spec in
 * it still gets its own tenant.
 *
 * Writes `qa/.tenants/<CASEID>.json` for the spec/fixture to read.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const TESTS = join(ROOT, 'qa', 'tests');
const OUT = join(ROOT, 'qa', '.tenants');

const PROFILES = ['content', 'bare', 'org-limit', 'two-org'] as const;
type Profile = (typeof PROFILES)[number];

const args = process.argv.slice(2);

function option(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(`--${name}=`.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const caseArg = args.find(
  (arg, index) =>
    !arg.startsWith('--') &&
    !['--profile', '--role', '--run', '--plan'].includes(args[index - 1] ?? ''),
);
const jsonOnly = args.includes('--json');
const reset = args.includes('--reset');
const fresh = args.includes('--fresh');
const all = args.includes('--all');
const CASE_ID_PATTERN = /^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+$/;

/** One account in a declarative tenant shape. */
interface MemberSpec {
  /** Key under `tenant.users` (e.g. `teacher`, `teacher2`, `studentA`). */
  key: string;
  accountType: 'manager' | 'educator' | 'student';
  /** Org role when the account is an organization member. Default `member`. */
  orgRole?: 'admin' | 'teacher' | 'member';
  name?: string;
}

/**
 * Extra tenant shape, declarative so a case that needs a non-standard roster does
 * not have to seed inside the Playwright worker (which collides with the app and
 * the other workers on a 4-vCPU runner):
 *   `members` — explicit roster; replaces the default manager/teacher/student
 *   `groups`  — group names, the first is the default group
 *   `solo`    — one account that belongs to no organization at all
 */
interface ProfileShape {
  members?: MemberSpec[];
  groups?: string[];
  solo?: MemberSpec;
  /**
   * Several organizations that do **not** share an owner (`SEC-04`: two admins,
   * each a member of only their own org). Each org gets its own deterministic key.
   */
  orgs?: { owner: MemberSpec; members?: MemberSpec[] }[];
}

type ProfileEntry = string | ({ profile?: string; role?: string; plan?: string } & ProfileShape);

const USAGE =
  'usage: bun scripts/qa-tenant.ts <CASEID>|--all [--profile content|bare|org-limit] [--role teacher|manager|student] [--plan <key>] [--fresh] [--run <suffix>] [--json] [--reset]';

/**
 * The CI seed contract: `qa/tests/profiles/<CASE>.json` declares the tenant shape
 * a case needs, so a runner can seed every spec without guessing. One file per
 * case means two case PRs never edit the same file. An explicit `--profile` /
 * `--role` on the command line always wins.
 */
function manifestEntry(id: string): ProfileEntry | undefined {
  try {
    return JSON.parse(readFileSync(join(TESTS, 'profiles', `${id}.json`), 'utf8')) as ProfileEntry;
  } catch {
    return undefined;
  }
}

function declaredProfile(entry: ProfileEntry | undefined): Profile {
  const value = typeof entry === 'string' ? entry : entry?.profile;
  return value === 'bare' || value === 'org-limit' || value === 'two-org' ? value : 'content';
}

function declaredRole(entry: ProfileEntry | undefined): string | undefined {
  return typeof entry === 'string' ? undefined : entry?.role;
}

function declaredPlan(entry: ProfileEntry | undefined): string | undefined {
  return typeof entry === 'string' ? undefined : entry?.plan;
}

function declaredShape(entry: ProfileEntry | undefined): ProfileShape {
  if (typeof entry === 'string' || !entry) return {};
  return {
    members: entry.members,
    groups: entry.groups,
    solo: entry.solo,
    orgs: entry.orgs,
  };
}

/** The cases the suite actually runs: one spec file per case. */
function specsOnDisk(): string[] {
  if (!existsSync(TESTS)) return [];
  return readdirSync(TESTS, { withFileTypes: true })
    .filter((dir) => dir.isDirectory())
    .flatMap((dir) =>
      readdirSync(join(TESTS, dir.name))
        .filter((file) => file.endsWith('.spec.ts'))
        .map((file) => file.slice(0, -'.spec.ts'.length)),
    )
    .sort();
}

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

/**
 * `two-org` — one manager who is admin in two organizations (MGR-03). Both graphs
 * are built here so the spec never seeds at runtime: only the suite seeder does.
 */
async function seedTwoOrg(
  db: ReturnType<typeof createSeedDb>,
  caseId: string,
  runSuffix: string,
  solo?: MemberSpec,
) {
  const base = `${tenantKey(`qa/cases/${caseId}.md`, `${caseId}#${runSuffix}`, 'qa-shared')}::${runSuffix}`;
  const keyA = `${base}::org-a`;
  const keyB = `${base}::org-b`;
  const manager = buildAccount(keyA, 'manager', 'manager', { name: 'QA manager' });

  async function seedOrg(params: {
    key: string;
    name: string;
    groups: [string, string];
    members: SeedAccount[];
    /** The member promoted to the org's `teacher` role, so the counters differ. */
    teacher?: SeedAccount;
    invite: { id: string; email: string };
  }) {
    const { key, name, groups, members, teacher, invite } = params;
    const seeded = await seedTenantGraph(db, {
      key,
      org: { id: tenantId(key, 'org'), name },
      defaultGroup: { id: tenantId(key, 'group:default'), name: groups[0], isDefault: true },
      extraGroups: [{ id: tenantId(key, 'group:second'), name: groups[1], isDefault: false }],
      owner: manager,
      members,
      ownerOrgRole: 'admin',
    });

    // `seedTenantGraph` enrols every member with the org's `member` role; the case
    // needs one org with a teacher, so promote that tenant-local membership.
    if (teacher) {
      const promoted = await db
        .from('org_members')
        .update({ org_role_id: seeded.roleIds.teacher! })
        .eq('organization_id', seeded.orgId!)
        .eq('user_id', teacher.id);
      if (promoted.error)
        throw new Error(`seed ${key}: org_members(teacher) ${promoted.error.message}`);
      const groupRole = await db
        .from('group_members')
        .update({ role: 'teacher' })
        .eq('group_id', tenantId(key, 'group:default'))
        .eq('user_id', teacher.id);
      if (groupRole.error)
        throw new Error(`seed ${key}: group_members(teacher) ${groupRole.error.message}`);
    }

    // `/api/v1/organization/groups` lists a group only when it has a teacher member,
    // so the second group needs the manager enrolled as its teacher.
    const secondGroupTeacher = await db.from('group_members').upsert(
      {
        id: tenantId(key, 'gm:second:owner'),
        group_id: tenantId(key, 'group:second'),
        user_id: manager.id,
        role: 'teacher',
      },
      { onConflict: 'id' },
    );
    if (secondGroupTeacher.error) {
      throw new Error(
        `seed ${key}: group_members(second group) ${secondGroupTeacher.error.message}`,
      );
    }

    const invitation = await db.from('invitations').upsert(
      {
        id: invite.id,
        email: invite.email,
        token: `qa-mgr03-${invite.id.replace(/-/g, '').slice(0, 24)}`,
        organization_id: seeded.orgId!,
        target_org_role_id: seeded.roleIds.member!,
        inviter_id: manager.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        is_accepted: false,
      },
      { onConflict: 'id' },
    );
    if (invitation.error) throw new Error(`seed ${key}: invitations ${invitation.error.message}`);

    return {
      id: seeded.orgId!,
      name,
      groups,
      student: seeded.members[0],
      inviteEmail: invite.email,
      counts: { total: 1 + members.length, teachers: teacher ? 1 : 0, students: 1 },
    };
  }

  const studentA = buildAccount(keyA, 'student-a', 'student', {
    name: `QA MGR-03 S1 ${runSuffix}`,
  });
  const teacherA = buildAccount(keyA, 'teacher-a', 'educator', {
    name: `QA MGR-03 T1 ${runSuffix}`,
  });
  const studentB = buildAccount(keyB, 'student-b', 'student', {
    name: `QA MGR-03 S2 ${runSuffix}`,
  });

  const orgA = await seedOrg({
    key: keyA,
    name: `QA MGR-03 A ${runSuffix}`,
    groups: [`O1G1-${runSuffix}`, `O1G2-${runSuffix}`],
    members: [studentA, teacherA],
    teacher: teacherA,
    invite: { id: tenantId(keyA, 'invite:a'), email: `mgr03-invite-a-${runSuffix}@test.local` },
  });
  const orgB = await seedOrg({
    key: keyB,
    name: `QA MGR-03 B ${runSuffix}`,
    groups: [`O2G1-${runSuffix}`, `O2G2-${runSuffix}`],
    members: [studentB],
    invite: { id: tenantId(keyB, 'invite:b'), email: `mgr03-invite-b-${runSuffix}@test.local` },
  });

  const soloAccount = solo
    ? await ensureAccount(
        db,
        buildAccount(base, solo.key, solo.accountType, { name: solo.name ?? `QA ${solo.key}` }),
      )
    : undefined;

  const tenant = {
    case: caseId,
    profile: 'two-org',
    runSuffix: runSuffix || null,
    key: base,
    manager,
    orgA,
    orgB,
    users: {
      manager: { id: manager.id, email: manager.email, password: manager.password },
      studentA: { id: studentA.id, email: studentA.email, password: studentA.password },
      teacherA: { id: teacherA.id, email: teacherA.email, password: teacherA.password },
      studentB: { id: studentB.id, email: studentB.email, password: studentB.password },
      ...(soloAccount
        ? {
            [solo!.key]: {
              id: soloAccount.id,
              email: soloAccount.email,
              password: soloAccount.password,
            },
          }
        : {}),
    },
    // `org` mirrors org A so generic tooling (and `loadTenant`) still sees a tenant.
    org: { id: orgA.id, name: orgA.name },
    group: { id: tenantId(keyA, 'group:default'), name: `O1G1-${runSuffix}` },
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${caseId}.json`), JSON.stringify(tenant, null, 2));
  if (!jsonOnly) {
    console.log(`qa tenant ${caseId} (two-org, run ${runSuffix})`);
    console.log(`  org A    ${orgA.id}  ${orgA.name}`);
    console.log(`  org B    ${orgB.id}  ${orgB.name}`);
    console.log(`  manager  ${manager.email} / ${manager.password}`);
    console.log(`  file     qa/.tenants/${caseId}.json`);
  }
}

interface CaseOptions {
  profile?: string;
  role?: string;
  plan?: string;
  /** Shared batch suffix; one batch = one suite run. */
  runSuffix: string;
}

async function seedCase(db: ReturnType<typeof createSeedDb>, caseId: string, opts: CaseOptions) {
  const entry = manifestEntry(caseId);
  const profile = (opts.profile ?? declaredProfile(entry)) as Profile;
  const role = opts.role ?? declaredRole(entry) ?? 'teacher';
  const plan = opts.plan ?? declaredPlan(entry);
  const runSuffix = opts.runSuffix;
  const shape = declaredShape(entry);

  if (!PROFILES.includes(profile)) {
    throw new Error(`unknown profile "${profile}": expected ${PROFILES.join(', ')}`);
  }
  if (role !== 'teacher' && role !== 'manager' && role !== 'student') {
    throw new Error(`unknown role "${role}": expected teacher, manager or student`);
  }
  if (plan && profile === 'bare') {
    // A first-run tenant has no organization yet, so there is nothing to put on a plan.
    throw new Error('cannot combine --plan with the bare profile (no organization exists yet)');
  }
  if (plan && !/^[a-z][a-z0-9_]*$/.test(plan)) throw new Error(`invalid plan "${plan}"`);
  if (!existsSync(join(CASES, `${caseId}.md`))) {
    throw new Error(`unknown case ${caseId}: qa/cases/${caseId}.md is missing`);
  }

  // A run suffix makes each independent run a brand-new tenant; without one the
  // key is the stable `<case>::<case>::qa-shared` identity.
  const title = runSuffix ? `${caseId}#${runSuffix}` : caseId;
  const key = tenantKey(`qa/cases/${caseId}.md`, title, 'qa-shared');
  const orgId = tenantId(key, 'org');
  const groupId = tenantId(key, 'group:default');
  const accounts = {
    manager: buildAccount(key, 'manager', 'manager', { name: 'QA manager' }),
    teacher: buildAccount(key, 'teacher', 'educator', { name: 'QA teacher' }),
    teacher2: buildAccount(key, 'teacher2', 'educator', {
      name: 'QA teacher 2',
      orgRole: 'teacher',
    }),
    student: buildAccount(key, 'student', 'student', { name: 'QA student' }),
    invitee1: buildAccount(key, 'invitee1', 'student', { name: 'QA invitee 1' }),
    invitee2: buildAccount(key, 'invitee2', 'student', { name: 'QA invitee 2' }),
  };
  const bareAccount =
    role === 'manager'
      ? accounts.manager
      : role === 'student'
        ? accounts.student
        : accounts.teacher;
  const allAccounts: SeedAccount[] =
    profile === 'bare'
      ? [bareAccount]
      : profile === 'org-limit'
        ? Object.values(accounts)
        : [accounts.manager, accounts.teacher, accounts.student];

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
      for (const account of allAccounts) {
        if (account.id) await db.auth.admin.deleteUser(account.id).catch(() => undefined);
      }
    }
    if (!jsonOnly) console.log(`qa tenant ${caseId}: reset (${profile})`);
    return;
  }

  if (profile === 'two-org') {
    await seedTwoOrg(db, caseId, runSuffix, shape.solo);
    return;
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
    return;
  }

  // Declarative multi-org (`orgs` in the profile file): each org has its own owner,
  // so isolation between organizations can be asserted without seeding in the test.
  if (shape.orgs?.length) {
    const orgUsers: Record<string, { id: string; email: string; password: string }> = {};
    const seededOrgs: { id: string; name: string; groupId: string; groupName: string }[] = [];

    for (const [index, orgSpec] of shape.orgs.entries()) {
      // A distinct seeding key per org keeps every derived id (memberships, group
      // rows) unique while staying deterministic.
      const orgKey = index === 0 ? key : `${key}:org${index + 1}`;
      const suffix = index === 0 ? '' : `-${index + 1}`;
      const groupNames = shape.groups?.length ? shape.groups : ['G1'];
      const toAccount = (member: MemberSpec) =>
        buildAccount(orgKey, member.key, member.accountType, {
          name: member.name ?? `QA ${member.key}`,
          ...(member.orgRole ? { orgRole: member.orgRole } : {}),
        });

      const seededOrg = await seedTenantGraph(db, {
        key: orgKey,
        org: { id: tenantId(orgKey, 'org'), name: `${orgName}${suffix}` },
        defaultGroup: {
          id: tenantId(orgKey, 'group:default'),
          name: groupNames[0],
          isDefault: true,
        },
        extraGroups: groupNames.slice(1).map((name, extraIndex) => ({
          id: tenantId(orgKey, `group:${extraIndex + 2}`),
          name,
          isDefault: false,
        })),
        owner: toAccount({ ...orgSpec.owner, orgRole: orgSpec.owner.orgRole ?? 'admin' }),
        members: (orgSpec.members ?? []).map((member) => ({
          ...toAccount(member),
          orgRole: member.orgRole ?? 'member',
        })),
        ownerOrgRole: orgSpec.owner.orgRole ?? 'admin',
      });

      orgUsers[orgSpec.owner.key] = {
        id: seededOrg.owner.id,
        email: seededOrg.owner.email,
        password: seededOrg.owner.password,
      };
      (orgSpec.members ?? []).forEach((member, memberIndex) => {
        const account = seededOrg.members[memberIndex];
        orgUsers[member.key] = {
          id: account.id,
          email: account.email,
          password: account.password,
        };
      });
      seededOrgs.push({
        id: tenantId(orgKey, 'org'),
        name: `${orgName}${suffix}`,
        groupId: tenantId(orgKey, 'group:default'),
        groupName: groupNames[0],
      });
    }

    writeTenant({
      case: caseId,
      profile,
      runSuffix: runSuffix || null,
      key,
      org: { id: seededOrgs[0].id, name: seededOrgs[0].name },
      group: { id: seededOrgs[0].groupId, name: seededOrgs[0].groupName },
      orgs: seededOrgs.map((org, index) => ({
        key: index === 0 ? 'a' : `org${index + 1}`,
        ...org,
      })),
      users: orgUsers,
    });
    return;
  }

  // Declarative roster (`members` / `groups` / `solo` in the case's profile file):
  // a case with a non-standard set of accounts — two educators with different org
  // roles, an exact three-person roster, a second empty group, an org-less control —
  // declares it here instead of seeding inside the Playwright worker, where it would
  // collide with the app and the other workers on the CI runner.
  if (shape.members?.length) {
    const specs = shape.members;
    const ownerSpec = specs.find((member) => member.orgRole === 'admin') ?? specs[0];
    const memberSpecs = specs.filter((member) => member !== ownerSpec);
    const toAccount = (member: MemberSpec) =>
      buildAccount(key, member.key, member.accountType, {
        name: member.name ?? `QA ${member.key}`,
        ...(member.orgRole ? { orgRole: member.orgRole } : {}),
      });
    const groupNames = shape.groups?.length ? shape.groups : ['G1'];

    const seededShape = await seedTenantGraph(db, {
      key,
      org: { id: orgId, name: orgName },
      defaultGroup: { id: groupId, name: groupNames[0], isDefault: true },
      extraGroups: groupNames.slice(1).map((name, index) => ({
        id: tenantId(key, `group:${index + 2}`),
        name,
        // `groups.is_default` is NOT NULL — every extra group must say `false`.
        isDefault: false,
      })),
      owner: toAccount(ownerSpec),
      members: memberSpecs.map((member) => ({
        ...toAccount(member),
        orgRole: member.orgRole ?? 'member',
      })),
      ownerOrgRole: ownerSpec.orgRole ?? 'admin',
    });

    if (plan) {
      const { error } = await db.rpc('apply_org_plan', { p_org_id: orgId, p_plan: plan });
      if (error) throw new Error(`seed ${caseId}: apply_org_plan(${plan}) ${error.message}`);
    }

    const shapeUsers: Record<string, { id: string; email: string; password: string }> = {
      [ownerSpec.key]: {
        id: seededShape.owner.id,
        email: seededShape.owner.email,
        password: seededShape.owner.password,
      },
    };
    memberSpecs.forEach((member, index) => {
      const account = seededShape.members[index];
      shapeUsers[member.key] = {
        id: account.id,
        email: account.email,
        password: account.password,
      };
    });
    if (shape.solo) {
      const solo = await ensureAccount(
        db,
        buildAccount(key, shape.solo.key, shape.solo.accountType, {
          name: shape.solo.name ?? `QA ${shape.solo.key}`,
        }),
      );
      shapeUsers[shape.solo.key] = { id: solo.id, email: solo.email, password: solo.password };
    }

    writeTenant({
      case: caseId,
      profile,
      runSuffix: runSuffix || null,
      key,
      plan: plan ?? null,
      org: { id: orgId, name: orgName },
      group: { id: groupId, name: groupNames[0] },
      users: shapeUsers,
    });
    return;
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
}

loadEnv();

if (all) {
  const cases = specsOnDisk();
  if (cases.length === 0) {
    console.error('--all found no specs under qa/tests/*/*.spec.ts');
    process.exit(2);
  }
  // One suffix for the whole batch: a suite run is one tenant set, and every
  // spec still owns its own tenant inside it.
  const runSuffix = option('run') ?? `r${Date.now().toString(36)}${randomTag(4)}`;
  const db = createSeedDb();
  for (const id of cases) {
    if (!CASE_ID_PATTERN.test(id)) {
      console.error(`skipping ${id}: not a case id`);
      continue;
    }
    await seedCase(db, id, { runSuffix });
  }
  if (!jsonOnly) console.log(`qa tenants: seeded ${cases.length} cases (run ${runSuffix})`);
  process.exit(0);
}

if (!caseArg || !CASE_ID_PATTERN.test(caseArg)) {
  console.error(USAGE);
  process.exit(2);
}

// A run suffix makes each independent run a brand-new tenant; without one the
// key is the stable `<case>::<case>::qa-shared` identity.
const runSuffix = option('run') ?? (fresh ? `r${Date.now().toString(36)}${randomTag(4)}` : '');

try {
  await seedCase(createSeedDb(), caseArg, {
    profile: option('profile'),
    role: option('role'),
    plan: option('plan'),
    runSuffix,
  });
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}
