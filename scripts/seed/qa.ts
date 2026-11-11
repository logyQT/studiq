/**
 * QA seeder, plan — seed (or reset) one tenant per QA case.
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
 * Security runs (see `qa/security/ROE.md`) must seed their own local stack:
 *
 *   bun scripts/qa-tenant.ts SEC-02 --profile two-org --fresh --dedicated
 *
 * Every case in one process (CI, before the suite starts — the same shape as
 * `scripts/e2e-seed.ts`, so seeding never runs while the suite is loading the app):
 *
 *   bun scripts/qa-tenant.ts --all --run "ci$GITHUB_RUN_ID"
 *   bun scripts/qa-tenant.ts --all --areas STU,LIM,NFR --run "ci$GITHUB_RUN_ID"
 *
 * `--areas` narrows a batch to the areas one CI shard actually runs, so a shard
 * does not pay for the 120 tenants it will never open. Cases inside a batch are
 * seeded with bounded concurrency (`QA_SEED_CONCURRENCY`, default 8): one tenant
 * costs ~6 sequential HTTP round-trips and the batch wall-clock is latency, not
 * CPU, so a pool is what makes it fast. Tenants are disjoint — each owns its
 * accounts, org, groups and memberships — so parallel cases cannot collide.
 *
 * **One tenant per attempt.** CI retries a failed test twice (`--attempts 3`,
 * the default) and `--repeat-each` replays it (`--repeats`, default 1), so each
 * `(repeat, retry)` gets its own pristine tenant:
 *
 *   qa/.tenants/<CASE>.json            # attempt 0 (the base file)
 *   qa/.tenants/<CASE>.r0e0.json       # copy of the base file, read by attempt 0
 *   qa/.tenants/<CASE>.r0e1.json       # repeat 0, retry 1
 *   qa/.tenants/<CASE>.r0e2.json       # repeat 0, retry 2
 *
 * `loadTenant()` reads the attempt file that matches `test.info()`, so a retry
 * never inherits the failed attempt's writes — no case-specific cleanup needed.
 * The extra attempts cost ~2x the tenant work (170 cases: 2.5 s -> 7 s locally,
 * ~2.5 s per CI shard). `--attempts 1 --repeats 1` seeds only the base tenant.
 * Tenant keys carry the same `-r<repeat>e<retry>` tag, so every derived id and
 * email stays unique per attempt.
 *
 * All ids are deterministic from the case id and the attempt tag. The spec
 * builds its own decks/banks/quizzes through the API, so nothing shared leaks
 * between cases.
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
 * Writes `qa/.tenants/<CASEID>.json` plus the per-attempt files above for the
 * spec/fixture to read.
 *
 * When `SUPABASE_DB_URL` is set (CI, or a checkout that lists it in root
 * `.env.local`), auth users are inserted straight into `auth.users` in
 * one statement — the shape `supabase/seeds/01_users.sql` used — instead of one
 * GoTrue admin call per account. GoTrue hashes each created password with bcrypt
 * (~64 ms of CPU per user); the SQL path hashes the batch's one shared password
 * once. Without a direct Postgres URL the script falls back to the Admin API.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  ensureAccounts,
  randomTag,
  seedTenantGraph,
  tenantId,
  type AccountWriter,
  type SeedAccount,
} from '#test/helpers/tenant-seed';
import {
  concurrencyFromEnv,
  countOption,
  createSeedDb,
  fail,
  finish,
  flag,
  loadEnv,
  optionalAccountWriter,
  optionalSql,
  option,
  printBlock,
  printJson,
  resetRequested,
  runBounded,
  runOption,
} from './cli';

const ROOT = join(import.meta.dir, '..', '..');
const CASES = join(ROOT, 'qa', 'cases');
const TESTS = join(ROOT, '__tests__', 'qa');
const OUT = join(ROOT, 'qa', '.tenants');

const PROFILES = ['content', 'bare', 'org-limit', 'two-org'] as const;
type Profile = (typeof PROFILES)[number];

const CASE_ID_PATTERN = /^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+$/;

/** `qa/.tenants/<CASE><fileSuffix>.json`; attempt 0 has no suffix (the base file). */
function tenantFile(caseId: string, fileSuffix: string): string {
  return join(OUT, `${caseId}${fileSuffix}.json`);
}

/**
 * The run suffix (and therefore the tenant key) for one attempt. Attempt 0
 * keeps the plain run suffix so an already-seeded first attempt keeps its ids;
 * every other attempt is tagged. The tag order is `r<repeat>e<retry>`, exactly
 * `loadTenant()` derives from `test.info()`.
 */
/** `-r<repeat>e<retry>`, or `''` for attempt 0 (the base tenant). */
function attemptTag(r: number, e: number): string {
  return r === 0 && e === 0 ? '' : `-r${r}e${e}`;
}

function attemptSpec(r: number, e: number): { fileSuffix: string; runTag: string; quiet: boolean } {
  const tag = attemptTag(r, e);
  return { fileSuffix: tag ? `.r${r}e${e}` : '', runTag: tag, quiet: tag !== '' };
}

/** The seed run suffix for one attempt; attempt 0 keeps the plain base suffix. */
function attemptRunSuffix(base: string, r: number, e: number): string {
  const tag = attemptTag(r, e);
  if (!base) return tag ? `r${r}e${e}` : '';
  return `${base}${tag}`;
}

/**
 * Delete a case's per-attempt tenant files from an earlier seed.
 *
 * The file set must match the current `--attempts`/`--repeats`: a reseed with fewer
 * attempts (or `--repeats 1`) must not leave `.r1e0.json` behind, because
 * `loadTenant()` would happily read that stale tenant.
 */
function clearAttemptFiles(caseId: string): void {
  if (!existsSync(OUT)) return;
  const prefix = `${caseId}.r`;
  for (const file of readdirSync(OUT)) {
    if (file.startsWith(prefix) && /\.r\d+e\d+\.json$/.test(file)) {
      unlinkSync(join(OUT, file));
    }
  }
}

async function copyBaseToAttempt0(caseId: string): Promise<void> {
  const base = tenantFile(caseId, '');
  if (!existsSync(base)) return;
  writeFileSync(tenantFile(caseId, '.r0e0'), readFileSync(base));
}

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
  'usage: bun scripts/qa-tenant.ts <CASEID>|--all [--areas STU,LIM,NFR] [--profile content|bare|org-limit] [--role teacher|manager|student] [--plan <key>] [--fresh] [--run <suffix>] [--attempts 3] [--repeats 1] [--dedicated] [--json] [--reset]';

/**
 * The CI seed contract: `__tests__/qa/profiles/<CASE>.json` declares the tenant shape
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

/**
 * The cases the suite actually runs: one spec file per case.
 *
 * `*-temp.spec.ts` variants reuse their parent case's tenant (the temp spec
 * loads `qa/.tenants/<CASE>.json`); they are not case ids, so they must not be
 * seeded as separate cases or validated by `CASE_ID_PATTERN`.
 */
function specsOnDisk(areas: string[]): string[] {
  if (!existsSync(TESTS)) return [];
  const byArea = new Map(
    readdirSync(TESTS, { withFileTypes: true })
      .filter((dir) => dir.isDirectory())
      .map((dir) => [
        dir.name,
        readdirSync(join(TESTS, dir.name))
          .filter((file) => file.endsWith('.spec.ts') && !file.endsWith('-temp.spec.ts'))
          .map((file) => file.slice(0, -'.spec.ts'.length)),
      ]),
  );

  if (areas.length) {
    // A typo in `--areas` would otherwise seed nothing and fail later as a
    // missing tenant file inside a spec, which is much harder to read.
    const unknown = areas.filter((area) => !byArea.get(area)?.length);
    if (unknown.length) {
      const known = [...byArea]
        .filter(([, specs]) => specs.length)
        .map(([area]) => area)
        .sort()
        .join(', ');
      throw new Error(`unknown --areas ${unknown.join(',')}: expected a subset of ${known}`);
    }
  }

  return [...byArea]
    .filter(([area, specs]) => specs.length > 0 && (areas.length === 0 || areas.includes(area)))
    .flatMap(([, specs]) => specs)
    .sort();
}

/**
 * Ports the shared QA stack keeps fixed: its API and its Postgres. A security
 * seed must never write to either, so both endpoints are checked.
 */
const SHARED_QA_PORTS = new Set(['54421', '54422']);

/** Parse an endpoint, returning `undefined` when it is missing or malformed. */
function parseEndpoint(raw: string | undefined): URL | undefined {
  try {
    return raw ? new URL(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** Require one endpoint to be a loopback URL that is not the shared QA stack. */
function assertLocalEndpoint(name: string, raw: string | undefined): URL {
  const url = parseEndpoint(raw);
  const isLocal = url?.hostname === 'localhost' || url?.hostname === '127.0.0.1';

  if (!url || !isLocal) {
    throw new Error(
      `--dedicated refuses to seed ${raw ?? `(unset ${name})`}: ` +
        'security seeding needs your own local Supabase',
    );
  }
  if (SHARED_QA_PORTS.has(url.port)) {
    throw new Error(
      `--dedicated refuses to seed ${raw}: the shared QA stack (${url.port}) is off limits`,
    );
  }
  return url;
}

/**
 * `--dedicated` preflight, run after `loadEnv()` and **before either writer
 * exists**: the REST client (`NEXT_PUBLIC_SUPABASE_URL`, which `qa/env.json`
 * may have overridden) and the optional SQL writer (`SUPABASE_DB_URL`) that
 * creates auth users directly. Both endpoints must be loopback and off the
 * shared QA ports; `env:ensure` exports the pair from one `supabase status`
 * call, so a passing pair normally belongs to this checkout's own stack (and a
 * `qa/env.json` target drops a DB URL that points elsewhere, see `loadEnv`).
 */
function assertDedicatedStack(dedicated: boolean): void {
  if (!dedicated) return;

  assertLocalEndpoint('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
  const dbRaw = process.env.SUPABASE_DB_URL;
  if (!dbRaw) return;

  assertLocalEndpoint('SUPABASE_DB_URL', dbRaw);
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
  write?: AccountWriter,
  fileSuffix = '',
  quiet = false,
  jsonOnly = false,
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
    const seeded = await seedTenantGraph(
      db,
      {
        key,
        org: { id: tenantId(key, 'org'), name },
        defaultGroup: { id: tenantId(key, 'group:default'), name: groups[0], isDefault: true },
        extraGroups: [{ id: tenantId(key, 'group:second'), name: groups[1], isDefault: false }],
        owner: manager,
        members,
        ownerOrgRole: 'admin',
      },
      write,
    );

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
    ? (
        await ensureAccounts(
          db,
          [buildAccount(base, solo.key, solo.accountType, { name: solo.name ?? `QA ${solo.key}` })],
          write,
        )
      )[0]
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
  writeFileSync(tenantFile(caseId, fileSuffix), JSON.stringify(tenant, null, 2));
  if (!jsonOnly && !quiet) {
    // One write: `--all` seeds cases concurrently (see the note on the batch).
    printBlock([
      `qa tenant ${caseId} (two-org, run ${runSuffix})`,
      `  org A    ${orgA.id}  ${orgA.name}`,
      `  org B    ${orgB.id}  ${orgB.name}`,
      `  manager  ${manager.email} / ${manager.password}`,
      `  file     qa/.tenants/${caseId}${fileSuffix}.json`,
    ]);
  }
}

interface CaseOptions {
  profile?: string;
  role?: string;
  plan?: string;
  /** Shared batch suffix; one batch = one suite run. */
  runSuffix: string;
  /** `''` for the base file, `.r<repeat>e<retry>` for every other attempt. */
  fileSuffix?: string;
  /** Attempts after the first stay out of the log/`--json` output. */
  quiet?: boolean;
  /** Batch account writer; omitted = one GoTrue admin call per account. */
  write?: AccountWriter;
  /** Global `--reset`: delete this tenant instead of seeding it. */
  reset: boolean;
  /** Global `--json`: print the tenant object instead of the human block. */
  jsonOnly: boolean;
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

  const fileSuffix = opts.fileSuffix ?? '';

  function writeTenant(tenant: Record<string, unknown>): void {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(tenantFile(caseId, fileSuffix), JSON.stringify(tenant, null, 2));

    if (opts.jsonOnly) {
      if (!opts.quiet) printJson(tenant);
      return;
    }
    if (opts.quiet) return;

    // One write per tenant: `--all` runs cases concurrently, so a block that is
    // logged line by line interleaves with the other tenants seeded beside it.
    const lines = [
      `qa tenant ${caseId} (${profile}${profile === 'bare' ? `/${role}` : ''}${runSuffix ? `, run ${runSuffix}` : ''})`,
    ];
    if (tenant.org) {
      const org = tenant.org as { id: string; name: string };
      lines.push(`  org      ${org.id}  ${org.name}`);
    } else {
      lines.push(`  org      none (first-run ${role})`);
    }
    if (tenant.plan) lines.push(`  plan     ${String(tenant.plan)}`);
    for (const [name, user] of Object.entries(
      tenant.users as Record<string, { email: string; password: string }>,
    )) {
      lines.push(`  ${name.padEnd(8)} ${user.email} / ${user.password}`);
    }
    if (tenant.group) {
      const group = tenant.group as { id: string; name: string };
      lines.push(`  group    ${group.id}  ${group.name}`);
    }
    lines.push(`  file     qa/.tenants/${caseId}${fileSuffix}.json`);
    printBlock(lines);
  }

  if (opts.reset) {
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
    if (!opts.jsonOnly && !opts.quiet) console.log(`qa tenant ${caseId}: reset (${profile})`);
    return;
  }

  if (profile === 'two-org') {
    await seedTwoOrg(
      db,
      caseId,
      runSuffix,
      shape.solo,
      opts.write,
      fileSuffix,
      opts.quiet,
      opts.jsonOnly,
    );
    return;
  }

  if (profile === 'bare') {
    // The account must exist before the membership sweep (FK), so create first and
    // then guarantee it belongs to no organization.
    const seeded = await seedTenantGraph(
      db,
      {
        key,
        org: null,
        defaultGroup: null,
        extraGroups: [],
        owner: bareAccount,
        members: [],
        ownerOrgRole: 'member',
      },
      opts.write,
    );
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

      const seededOrg = await seedTenantGraph(
        db,
        {
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
        },
        opts.write,
      );

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

    const seededShape = await seedTenantGraph(
      db,
      {
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
      },
      opts.write,
    );

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
      const [solo] = await ensureAccounts(
        db,
        [
          buildAccount(key, shape.solo.key, shape.solo.accountType, {
            name: shape.solo.name ?? `QA ${shape.solo.key}`,
          }),
        ],
        opts.write,
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
    const [invitee1, invitee2] = await ensureAccounts(
      db,
      [accounts.invitee1, accounts.invitee2],
      opts.write,
    );
    ensured.invitee1 = invitee1;
    ensured.invitee2 = invitee2;
  }

  const seeded = await seedTenantGraph(
    db,
    {
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
    },
    opts.write,
  );

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

/** Seed (or reset) the requested QA case tenants. */
export async function runQaSeed(): Promise<void> {
  const args = process.argv.slice(2);

  const caseArg = args.find(
    (arg, index) =>
      !arg.startsWith('--') &&
      !['--profile', '--role', '--run', '--plan', '--areas', '--attempts', '--repeats'].includes(
        args[index - 1] ?? '',
      ),
  );
  const jsonOnly = flag(args, 'json');
  const reset = resetRequested(args);
  const fresh = flag(args, 'fresh');
  const all = flag(args, 'all');
  /**
   * Security seeds (see `qa/security/ROE.md`) must never touch the shared QA
   * database, which holds other agents' tenants.
   */
  const dedicated = flag(args, 'dedicated');
  /** `--areas STU,LIM,NFR` — restrict `--all` to the areas a CI shard runs. */
  const areas = (option(args, 'areas') ?? '')
    .split(',')
    .map((area) => area.trim().toUpperCase())
    .filter(Boolean);

  /**
   * Attempt count = Playwright `retries + 1` (CI uses 2 retries) and repeat count
   * = `--repeat-each`. Every attempt gets its own tenant file, so a retry never
   * inherits the failed attempt's writes.
   */
  const attempts = countOption(args, 'attempts', 3);
  const repeats = countOption(args, 'repeats', 1);

  loadEnv(ROOT);

  // `--dedicated` runs before either writer is constructed, so no SQL writer can
  // reach a non-local or shared stack even when the REST client would be fine.
  try {
    assertDedicatedStack(dedicated);
  } catch (error) {
    fail((error as Error).message);
  }

  // A direct Postgres URL unlocks SQL account seeding (see `createSqlAccountWriter`).
  // Root `.env.local` or CI supplies it, but it stays optional: without it
  // accounts go through GoTrue's admin API.
  const seedSql = optionalSql();
  const writeAccounts = optionalAccountWriter(seedSql);

  if (all) {
    let cases: string[];
    try {
      cases = specsOnDisk(areas);
    } catch (error) {
      fail((error as Error).message);
    }
    if (cases.length === 0) {
      fail(
        areas.length
          ? `--areas ${areas.join(',')} matched no specs under __tests__/qa/<area>/*.spec.ts`
          : '--all found no specs under __tests__/qa/*/*.spec.ts',
      );
    }
    // One suffix for the whole batch: a suite run is one tenant set, and every
    // spec still owns its own tenant inside it.
    const runSuffix = runOption(args) ?? `r${Date.now().toString(36)}${randomTag(4)}`;
    const db = createSeedDb();
    // Every tenant is a handful of sequential round-trips, so cases are seeded with
    // a bounded pool instead of one after another. Without `SUPABASE_DB_URL` the pool is
    // also what keeps the per-account GoTrue calls off the critical path; with it,
    // the graph writes are the only serial work left.
    const failures: string[] = [];
    const started = performance.now();

    // One tenant per (case, repeat, retry): a retry must not inherit the failed
    // attempt's writes, so the spec's `loadTenant()` picks the attempt file that
    // matches `test.info()` (see `qa/fixtures/qa-tenant.ts`).
    for (const id of cases) clearAttemptFiles(id);

    const tasks = cases.flatMap((id) => {
      const list: { id: string; repeat: number; retry: number }[] = [];
      for (let repeat = 0; repeat < repeats; repeat++) {
        for (let retry = 0; retry < attempts; retry++) list.push({ id, repeat, retry });
      }
      return list;
    });

    await runBounded(tasks, concurrencyFromEnv('QA_SEED_CONCURRENCY'), async (task) => {
      const { id, repeat, retry } = task;
      if (!CASE_ID_PATTERN.test(id)) {
        failures.push(`${id}: not a case id`);
        return;
      }
      const spec = attemptSpec(repeat, retry);
      try {
        await seedCase(db, id, {
          runSuffix: attemptRunSuffix(runSuffix, repeat, retry),
          fileSuffix: spec.fileSuffix,
          quiet: spec.quiet,
          write: writeAccounts,
          reset,
          jsonOnly,
        });
      } catch (error) {
        failures.push(`${id}${spec.fileSuffix}: ${(error as Error).message}`);
      }
    });

    // Only mirror a successful seed: a failed case must not leave a stale attempt-0
    // copy beside a half-written base file.
    if (!reset && failures.length === 0) {
      await Promise.all(cases.map((id) => copyBaseToAttempt0(id)));
    }

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    if (failures.length) {
      for (const failure of failures) console.error(`seed failed: ${failure}`);
      console.error(
        `qa tenants: ${failures.length}/${cases.length} cases failed after ${seconds}s`,
      );
      await finish(seedSql, 2);
    }
    if (!jsonOnly) {
      const scope = areas.length ? ` (${areas.join(',')})` : '';
      console.log(
        `qa tenants: seeded ${cases.length} cases${scope} in ${seconds}s (run ${runSuffix})`,
      );
    }
    await finish(seedSql, 0);
  }

  if (!caseArg || !CASE_ID_PATTERN.test(caseArg)) {
    fail(USAGE);
  }

  // A run suffix makes each independent run a brand-new tenant; without one the
  // key is the stable `<case>::<case>::qa-shared` identity.
  const runSuffix = runOption(args) ?? (fresh ? `r${Date.now().toString(36)}${randomTag(4)}` : '');

  const caseDb = createSeedDb();
  try {
    clearAttemptFiles(caseArg);
    for (let repeat = 0; repeat < repeats; repeat++) {
      for (let retry = 0; retry < attempts; retry++) {
        const spec = attemptSpec(repeat, retry);
        await seedCase(caseDb, caseArg, {
          profile: option(args, 'profile'),
          role: option(args, 'role'),
          plan: option(args, 'plan'),
          runSuffix: attemptRunSuffix(runSuffix, repeat, retry),
          fileSuffix: spec.fileSuffix,
          quiet: spec.quiet,
          write: writeAccounts,
          reset,
          jsonOnly,
        });
      }
    }
    if (!reset) await copyBaseToAttempt0(caseArg);
  } catch (error) {
    fail((error as Error).message);
  }
  await finish(seedSql, 0);
}
