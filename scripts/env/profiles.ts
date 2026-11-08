/**
 * Profile -> capability table (spec §3), the single source of truth for the
 * `supabase stack start -x` exclude list.
 *
 * A profile is the contract; atoms only add capabilities to it. `database` is
 * always on and is never passed to `-x`. `db` keeps `auth` and `storage`
 * because this repo's migrations need `storage.buckets` and its seeds need
 * `auth.users.email_confirmed_at` (settled in phase 0).
 */

export const PROFILE_NAMES = ['db', 'api', 'mail', 'full', 'web', 'qa', 'e2e', 'admin'] as const;

export type ProfileName = (typeof PROFILE_NAMES)[number];

export type Capability =
  | 'database'
  | 'rest'
  | 'auth'
  | 'storage'
  | 'studio'
  | 'realtime'
  | 'functions'
  | 'mail'
  | 'analytics'
  | 'pooler';

/** Capability atoms use the CLI's names (`--db` maps to `database`). */
export const CAPABILITY_ATOMS = [
  'db',
  'rest',
  'auth',
  'storage',
  'studio',
  'mail',
  'functions',
  'analytics',
  'realtime',
  'pooler',
] as const;

export type CapabilityAtom = (typeof CAPABILITY_ATOMS)[number];

const ATOM_CAPABILITY: Record<CapabilityAtom, Capability> = {
  db: 'database',
  rest: 'rest',
  auth: 'auth',
  storage: 'storage',
  studio: 'studio',
  mail: 'mail',
  functions: 'functions',
  analytics: 'analytics',
  realtime: 'realtime',
  pooler: 'pooler',
};

export interface ProfileSpec {
  capabilities: readonly Capability[];
  /** Tenant seeding: only `qa`/`e2e` enable it (phase 3). */
  seed: boolean;
  build: boolean;
  serve: boolean;
  /**
   * Phase 2 implements `api` and `web`; the rest are declared here so the
   * table is complete and phase 3 only flips the gate.
   */
  availableInPhase2: boolean;
}

const DB_CAPABILITIES = ['database', 'auth', 'storage'] as const;
const API_CAPABILITIES = [...DB_CAPABILITIES, 'rest'] as const;
const MAIL_CAPABILITIES = [...API_CAPABILITIES, 'mail'] as const;
const FULL_CAPABILITIES = [...MAIL_CAPABILITIES] as const;

export const PROFILES: Record<ProfileName, ProfileSpec> = {
  db: {
    capabilities: DB_CAPABILITIES,
    seed: false,
    build: false,
    serve: false,
    availableInPhase2: false,
  },
  api: {
    capabilities: API_CAPABILITIES,
    seed: false,
    build: false,
    serve: false,
    availableInPhase2: true,
  },
  mail: {
    capabilities: MAIL_CAPABILITIES,
    seed: false,
    build: false,
    serve: false,
    availableInPhase2: false,
  },
  full: {
    capabilities: FULL_CAPABILITIES,
    seed: false,
    build: false,
    serve: false,
    availableInPhase2: false,
  },
  web: {
    capabilities: FULL_CAPABILITIES,
    seed: false,
    build: true,
    serve: true,
    availableInPhase2: true,
  },
  qa: {
    capabilities: FULL_CAPABILITIES,
    seed: true,
    build: true,
    serve: true,
    availableInPhase2: false,
  },
  e2e: {
    capabilities: FULL_CAPABILITIES,
    seed: true,
    build: true,
    serve: true,
    availableInPhase2: false,
  },
  admin: {
    capabilities: FULL_CAPABILITIES,
    seed: false,
    build: true,
    serve: true,
    availableInPhase2: false,
  },
};

/** The exact order the spec lists `-x` capabilities in. */
const EXCLUDE_ORDER: readonly Capability[] = [
  'rest',
  'studio',
  'mail',
  'realtime',
  'functions',
  'analytics',
  'pooler',
];

export function isProfileName(value: string): value is ProfileName {
  return (PROFILE_NAMES as ReadonlyArray<string>).includes(value);
}

export function isCapabilityAtom(value: string): value is CapabilityAtom {
  return (CAPABILITY_ATOMS as ReadonlyArray<string>).includes(value);
}

export class ProfileError extends Error {}

/**
 * The requested capability set: the profile's set plus every capability atom.
 * `studio` without `rest` is rejected here, at parse time, instead of letting
 * the CLI fail later ("Studio cannot be started without the REST API
 * capability").
 */
export function buildCapabilities(
  profile: ProfileName,
  atoms: readonly CapabilityAtom[],
): Set<Capability> {
  const capabilities = new Set<Capability>(PROFILES[profile].capabilities);
  for (const atom of atoms) capabilities.add(ATOM_CAPABILITY[atom]);
  if (capabilities.has('studio') && !capabilities.has('rest')) {
    throw new ProfileError(
      "'--studio' requires '--rest' (Studio cannot start without the REST API)",
    );
  }
  return capabilities;
}

/** Inclusive: a running superset satisfies a narrower request. */
export function isCapabilitySuperset(
  observed: Iterable<Capability>,
  requested: Iterable<Capability>,
): boolean {
  const have = new Set(observed);
  for (const capability of requested) {
    if (!have.has(capability)) return false;
  }
  return true;
}

export function missingCapabilities(
  observed: Iterable<Capability>,
  requested: Iterable<Capability>,
): Capability[] {
  const have = new Set(observed);
  return [...requested].filter((capability) => !have.has(capability));
}

/** `supabase stack start -x` value for a capability set. */
export function excludesFor(capabilities: Iterable<Capability>): Capability[] {
  const have = new Set(capabilities);
  return EXCLUDE_ORDER.filter((capability) => !have.has(capability));
}

export function profileRequiresServe(profile: string | null | undefined): boolean {
  if (!profile || !isProfileName(profile)) return false;
  return PROFILES[profile].serve;
}
