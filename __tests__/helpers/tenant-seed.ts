/**
 * Shared tenant seeder.
 *
 * The e2e suite (`scripts/e2e-seed.ts`) and the QA suite (`scripts/qa-tenant.ts`)
 * both provision isolated tenants through this module, so account/org/group
 * creation has one implementation. What differs between them is the *shape* they
 * ask for — the e2e seeder derives one tenant per Playwright test and adds
 * content, the QA seeder derives one tenant per case with the case's own roster —
 * not how a tenant is written.
 *
 * Accounts default to the Supabase Admin API (`auth.admin.createUser`); the two
 * CLI seeders instead pass a SQL writer (`createSqlAccountWriter`) because they
 * hold a direct Postgres connection. The default path must stay Admin-API based
 * so this module keeps running inside Vitest (which does not expose `bun:sql`).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SQL } from 'bun';
import { randomBytes } from 'node:crypto';
import type { Database } from '@studiq/server/types/database';
import { shortHash, uuidv5 } from '#test/e2e/fixtures/ids';

export type SeedAccountRole = 'student' | 'educator' | 'manager';

export type SeedDb = SupabaseClient<Database>;

export interface SeedAccount {
  id: string;
  email: string;
  password: string;
  role: SeedAccountRole;
  accountType: SeedAccountRole;
  name?: string;
  /**
   * Org role the account gets when the graph attaches it to the org
   * (default: `member`). Only relevant for `members`, never for `owner`.
   */
  orgRole?: 'admin' | 'teacher' | 'member';
}

export interface SeedGroup {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface TenantGraphSpec {
  key: string;
  org: { id: string; name: string } | null;
  /** The group every org gets on creation; null when `org` is null. */
  defaultGroup: SeedGroup | null;
  /** Additional groups, created without enrolling their creator (API parity). */
  extraGroups: SeedGroup[];
  owner: SeedAccount;
  members: SeedAccount[];
  /** Org role the creator gets — the org creator is always `admin` via the API. */
  ownerOrgRole: 'admin' | 'teacher' | 'member';
}

export interface SeededTenantGraph {
  orgId: string | null;
  defaultGroupId: string | null;
  groups: SeedGroup[];
  owner: SeedAccount;
  members: SeedAccount[];
  roleIds: Partial<Record<'admin' | 'teacher' | 'member', string>>;
}

// GoTrue rejects passwords shorter than 6 characters (the old SQL seeder used
// `pass`, which only worked because it bypassed the Auth API).
const PASSWORD = 'Seed4Test!';

/** Transport-level failures a busy CI runner can produce while seeding. */
const TRANSIENT_SEED_ERROR = /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network/i;

export function randomTag(length = 8): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

export function createSeedDb(overrides: { url?: string; serviceKey?: string } = {}): SeedDb {
  return createClient<Database>(
    overrides.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    overrides.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Deterministic id for an entity inside a seeded tenant. */
export function tenantId(key: string, entity: string): string {
  return uuidv5(`${key}:${entity}`);
}

/**
 * Build an account spec. Deterministic ids make a failing run reproducible; the
 * email carries a short hash of the key so fixtures never collide.
 */
export function buildAccount(
  key: string,
  suffix: string,
  role: SeedAccountRole,
  opts: {
    email?: string;
    password?: string;
    name?: string;
    orgRole?: 'admin' | 'teacher' | 'member';
  } = {},
): SeedAccount {
  const tag = shortHash(`${key}:${suffix}`);
  return {
    id: tenantId(key, suffix),
    email: opts.email ?? `seed-${role}-${tag}@dev.local`,
    password: opts.password ?? PASSWORD,
    role,
    accountType: role,
    name: opts.name ?? `Seed ${role} ${tag}`,
    orgRole: opts.orgRole,
  };
}

/**
 * How a batch of accounts is materialised. The default is the Supabase Admin API
 * (one GoTrue call per account, which hashes the password with bcrypt — ~64 ms of
 * CPU each, measured against the local stack). A caller that already holds a
 * direct Postgres connection can pass a writer that inserts the batch in one
 * statement instead; see `createSqlAccountWriter` in `scripts/qa-tenant.ts`.
 */
export type AccountWriter = (accounts: SeedAccount[]) => Promise<void>;

/**
 * Materialise a batch of accounts and return them with their ids resolved.
 *
 * Without a `write` hook every account goes through `ensureAccount`. With one,
 * the batch is written in a single statement and the ids are read back once, so
 * re-seeding an email that already exists under another id keeps working the
 * same way the Admin-API path does.
 */
export async function ensureAccounts(
  db: SeedDb,
  accounts: SeedAccount[],
  write?: AccountWriter,
): Promise<SeedAccount[]> {
  if (accounts.length === 0) return [];
  if (!write) return Promise.all(accounts.map((account) => ensureAccount(db, account)));

  await write(accounts);
  const { data, error } = await db
    .from('profiles')
    .select('id,email')
    .in(
      'email',
      accounts.map((account) => account.email),
    );
  if (error) throw new Error(`seed accounts: profiles lookup ${error.message}`);
  const byEmail = new Map((data ?? []).map((row) => [row.email, row.id]));

  return accounts.map((account) => {
    const id = byEmail.get(account.email);
    if (!id) throw new Error(`seed ${account.email}: the account insert did not create a profile`);
    return { ...account, id };
  });
}

/**
 * Auth users through one SQL statement, the way `supabase/seeds/01_users.sql` did.
 *
 * GoTrue's admin `createUser` bcrypts the password for every account (~64 ms of
 * CPU each, measured against the local stack), so a 500-tenant run spends ~30 s
 * of CPU on what is one shared test password. Here the hash is computed once
 * (pgcrypto, cost 10) and every row reuses it; the insert itself is ~0.1 ms per
 * user.
 *
 * The four empty-token columns are load-bearing: the auth schema leaves
 * `confirmation_token`, `recovery_token`, `email_change_token_new` and
 * `email_change` nullable with no default, but GoTrue scans them into Go strings.
 * Leaving them NULL makes password sign-in fail with `converting NULL to string
 * is unsupported` (500), which is why `01_users.sql` set them to '' too.
 *
 * `handle_new_user` still runs on the insert, so profiles (and their plan key) are
 * created exactly as they are for an Admin-API signup.
 */
export function createSqlAccountWriter(sql: SQL): AccountWriter {
  // Cache the *pending* query, not just its result: `runBounded` reaches this
  // writer from several tenants at once, and a value-only cache lets every
  // first-batch caller hash the same password again (8 bcrypts instead of 1).
  const hashes = new Map<string, Promise<string>>();

  return async (accounts) => {
    const password = accounts[0]?.password;
    if (!password || accounts.some((account) => account.password !== password)) {
      throw new Error('SQL account seeding needs one shared password per batch');
    }

    let pending = hashes.get(password);
    if (!pending) {
      pending = sql<{ hash: string }[]>`SELECT crypt(${password}, gen_salt('bf', 10)) AS hash`
        .then(([row]) => row.hash)
        .catch((error: unknown) => {
          // A rejected query is not a result — the next tenant should retry it.
          hashes.delete(password);
          throw error;
        });
      hashes.set(password, pending);
    }
    const hash = await pending;

    const ids = accounts.map((account) => account.id);
    const emails = accounts.map((account) => account.email);
    const types = accounts.map((account) => account.accountType);
    const names = accounts.map((account) => account.name ?? account.role);

    await sql`INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change
      )
      SELECT '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated',
             r.email, ${hash}, now(), now(), now(),
             jsonb_build_object('account_type', r.account_type),
             jsonb_build_object('name', r.name, 'email_verified', true, 'account_type', r.account_type),
             '', '', '', ''
      FROM unnest(${ids}::uuid[], ${emails}::text[], ${types}::text[], ${names}::text[])
        AS r(id, email, account_type, name)
      ON CONFLICT DO NOTHING`;

    // Same identity row GoTrue writes on `createUser` (one per e-mail provider),
    // so linked-provider reads and the session's `identities` stay identical.
    await sql`INSERT INTO auth.identities (
        provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      )
      SELECT u.id::text, u.id,
             jsonb_build_object('sub', u.id::text, 'email', u.email,
                                'email_verified', true, 'phone_verified', false),
             'email', now(), now(), now()
      FROM auth.users u
      WHERE u.id = ANY(${ids}::uuid[])
      ON CONFLICT DO NOTHING`;
  };
}

/** Bounded pool for the seeders: at most `limit` tenants in flight. */
export async function runBounded<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  const width = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 8;
  for (let index = 0; index < items.length; index += width) {
    await Promise.all(items.slice(index, index + width).map(run));
  }
}

/** Pool width for a seeder: `QA_SEED_CONCURRENCY` / `E2E_SEED_CONCURRENCY`, default 8. */
export function concurrencyFromEnv(name: string, fallback = 8): number {
  return Number(process.env[name] ?? fallback);
}

/** Create the auth user (and, through the DB trigger, its profile). */
export async function ensureAccount(db: SeedDb, account: SeedAccount): Promise<SeedAccount> {
  // A 4-worker CI run seeds several tenants at once; a dropped connection is a
  // transport hiccup, not a real seeding failure. Retry it with exponential
  // backoff before giving up, and treat "already registered" as success.
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { data: existing } = await db
      .from('profiles')
      .select('id')
      .eq('email', account.email)
      .maybeSingle();
    if (existing) return { ...account, id: existing.id };

    const { error } = await db.auth.admin.createUser({
      id: account.id,
      email: account.email,
      password: account.password,
      email_confirm: true,
      app_metadata: { account_type: account.accountType },
      user_metadata: {
        name: account.name ?? account.role,
        email_verified: true,
        account_type: account.accountType,
      },
    });
    if (!error) return account;

    const retryable = TRANSIENT_SEED_ERROR.test(error.message);
    if (!retryable || attempt === attempts)
      throw new Error(`seed ${account.email}: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(400 * 2 ** (attempt - 1), 4000)));
  }
  throw new Error(`seed ${account.email}: exhausted ${attempts} attempts`);
}

/**
 * Materialise a tenant's org graph: accounts → org → roles → default group →
 * memberships → extra groups. Idempotent; safe to re-run for the same key.
 */
export async function seedTenantGraph(
  db: SeedDb,
  spec: TenantGraphSpec,
  write?: AccountWriter,
): Promise<SeededTenantGraph> {
  const [owner, ...members] = await ensureAccounts(db, [spec.owner, ...spec.members], write);

  if (!spec.org) {
    return {
      orgId: null,
      defaultGroupId: null,
      groups: [],
      owner,
      members,
      roleIds: {},
    };
  }

  const { error: orgError } = await db
    .from('organizations')
    .upsert({ id: spec.org.id, name: spec.org.name }, { onConflict: 'id' });
  if (orgError) throw new Error(`seed ${spec.key}: org ${orgError.message}`);

  const roles =
    (await db.from('org_roles').select('id,name').eq('organization_id', spec.org.id)).data ?? [];
  const roleIds: SeededTenantGraph['roleIds'] = {};
  for (const role of roles) {
    if (role.name === 'admin' || role.name === 'teacher' || role.name === 'member') {
      roleIds[role.name] = role.id;
    }
  }
  for (const name of ['admin', 'teacher', 'member'] as const) {
    if (!roleIds[name]) {
      throw new Error(`seed ${spec.key}: organization trigger did not create the ${name} role`);
    }
  }

  const now = new Date().toISOString();
  const { error: memberError } = await db.from('org_members').upsert(
    [
      {
        id: tenantId(spec.key, 'member:owner'),
        organization_id: spec.org.id,
        user_id: owner.id,
        org_role_id: roleIds[spec.ownerOrgRole]!,
        joined_at: now,
      },
      ...members.map((member, index) => ({
        id: tenantId(spec.key, `member:${index}`),
        organization_id: spec.org!.id,
        user_id: member.id,
        org_role_id: roleIds[member.orgRole ?? 'member']!,
        joined_at: now,
      })),
    ],
    { onConflict: 'id' },
  );
  if (memberError) throw new Error(`seed ${spec.key}: org_members ${memberError.message}`);

  const groups = spec.defaultGroup ? [spec.defaultGroup, ...spec.extraGroups] : spec.extraGroups;
  const { error: groupError } = await db.from('groups').upsert(
    groups.map((group) => ({
      id: group.id,
      organization_id: spec.org!.id,
      name: group.name,
      created_by: owner.id,
      is_default: group.isDefault,
    })),
    { onConflict: 'id' },
  );
  if (groupError) throw new Error(`seed ${spec.key}: groups ${groupError.message}`);

  if (spec.defaultGroup) {
    const { error: groupMemberError } = await db.from('group_members').upsert(
      [
        {
          id: tenantId(spec.key, 'gm:owner'),
          group_id: spec.defaultGroup.id,
          user_id: owner.id,
          role: 'teacher',
        },
        ...members.map((member, index) => ({
          id: tenantId(spec.key, `gm:${index}`),
          group_id: spec.defaultGroup!.id,
          user_id: member.id,
          role: 'member',
        })),
      ],
      { onConflict: 'id' },
    );
    if (groupMemberError) {
      throw new Error(`seed ${spec.key}: group_members ${groupMemberError.message}`);
    }
  }

  return {
    orgId: spec.org.id,
    defaultGroupId: spec.defaultGroup?.id ?? null,
    groups,
    owner,
    members,
    roleIds,
  };
}
