/** Profile -> capability table for phase 2 (`api`, `web`). */
export const PROFILE_NAMES = ['api', 'web'] as const;
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
export const CAPABILITY_ATOMS = [
  'db',
  'rest',
  'auth',
  'storage',
  'studio',
  'mail',
  'realtime',
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
  analytics: 'analytics',
};

export interface ProfileSpec {
  capabilities: readonly Capability[];
  build: boolean;
  serve: boolean;
}

const API = ['database', 'auth', 'storage', 'rest'] as const;
export const PROFILES: Record<ProfileName, ProfileSpec> = {
  api: { capabilities: API, build: false, serve: false },
  web: { capabilities: [...API, 'mail'], build: true, serve: true },
};
// The lean stack never starts realtime/functions/analytics/pooler; they stay in
// the capability union so `-x` always excludes them unless an atom requests one
// (`--realtime`/`--analytics`).
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

export function buildCapabilities(
  profile: ProfileName,
  atoms: readonly CapabilityAtom[],
): Set<Capability> {
  const capabilities = new Set<Capability>(PROFILES[profile].capabilities);
  for (const atom of atoms) capabilities.add(ATOM_CAPABILITY[atom]);
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
  return Boolean(profile && isProfileName(profile) && PROFILES[profile].serve);
}
