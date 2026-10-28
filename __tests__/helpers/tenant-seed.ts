/**
 * Shared tenant seeder.
 *
 * The e2e suite (`scripts/e2e-seed.ts`) and the integration fixtures
 * (`__tests__/helpers/test-user.ts`) both provision isolated tenants through this
 * module, so account/org/group creation has one implementation.
 *
 * Accounts are created through the Supabase Admin API (`auth.admin.createUser`)
 * instead of raw SQL: the trigger `handle_new_user` then creates the profile and
 * copies `app_metadata.account_type`, and the module stays runnable inside
 * Vitest (which does not expose `bun:sql`).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
): Promise<SeededTenantGraph> {
  const owner = await ensureAccount(db, spec.owner);
  const members = await Promise.all(spec.members.map((member) => ensureAccount(db, member)));

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
