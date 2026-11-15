/**
 * Profile -> capability table (spec §3), the single source of truth for the
 * `supabase stack start -x` exclude list.
 *
 * A profile is the contract; atoms only add capabilities to it. `database` is
 * always on and is never passed to `-x`. `db` keeps `auth` and `storage`
 * because this repo's migrations need `storage.buckets` and its seeds need
 * `auth.users.email_confirmed_at` (settled in phase 0).
 */
export const PROFILE_NAMES = ['db', 'api', 'mail', 'full', 'web', 'qa', 'e2e'] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];
export type Capability =
  | 'database'
  | 'rest'
  | 'auth'
  | 'storage'
  | 'studio'
  | 'mail'
  | 'realtime'
  | 'functions'
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
  'realtime',
  'functions',
  'analytics',
] as const;
export type CapabilityAtom = (typeof CAPABILITY_ATOMS)[number];

const ATOM_CAPABILITY: Record<CapabilityAtom, Capability> = {
  db: 'database',
  rest: 'rest',
  auth: 'auth',
  storage: 'storage',
  studio: 'studio',
  mail: 'mail',
  realtime: 'realtime',
  functions: 'functions',
  analytics: 'analytics',
};

export interface ProfileSpec {
  capabilities: readonly Capability[];
  /** Tenant seeding: only `qa`/`e2e` enable it by default. */
  seed: boolean;
  build: boolean;
  serve: boolean;
}

const DB = ['database', 'auth', 'storage'] as const;
const API = [...DB, 'rest'] as const;
const MAIL = [...API, 'mail'] as const;
const FULL = [...MAIL] as const;

export const PROFILES: Record<ProfileName, ProfileSpec> = {
  db: { capabilities: DB, seed: false, build: false, serve: false },
  api: { capabilities: API, seed: false, build: false, serve: false },
  mail: { capabilities: MAIL, seed: false, build: false, serve: false },
  full: { capabilities: FULL, seed: false, build: false, serve: false },
  web: { capabilities: FULL, seed: false, build: true, serve: true },
  qa: { capabilities: FULL, seed: true, build: true, serve: true },
  e2e: { capabilities: FULL, seed: true, build: true, serve: true },
};

// The lean stack never starts realtime/functions/analytics/pooler; they stay in
// the capability union so `-x` always excludes them unless an atom requests one
// (`--realtime`/`--functions`/`--analytics`).
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

export function missingCapabilities(
  observed: Iterable<Capability>,
  requested: Iterable<Capability>,
): Capability[] {
  const have = new Set(observed);
  return [...requested].filter((capability) => !have.has(capability));
}

export function excludesFor(capabilities: Iterable<Capability>): Capability[] {
  const have = new Set(capabilities);
  return EXCLUDE_ORDER.filter((capability) => !have.has(capability));
}

export function profileRequiresServe(profile: string | null | undefined): boolean {
  if (!profile || !isProfileName(profile)) return false;
  return PROFILES[profile].serve;
}

export function profileSeeds(profile: string | null | undefined): boolean {
  if (!profile || !isProfileName(profile)) return false;
  return PROFILES[profile].seed;
}
