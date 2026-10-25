/**
 * Admin PEM gate primitives — keyring parsing, request signing payload and the
 * path → scope map.
 *
 * Pure Node: this module must not import Next (or anything that pulls it in) so
 * the same code can be used by `apps/admin/src/proxy.ts`, `scripts/admin-sign.ts`
 * and the tests. Keeping one implementation is what stops the signer and the
 * verifier from drifting apart.
 */
import { createHash, createPublicKey, type KeyObject, verify } from 'node:crypto';

/** Request headers used by the gate. Kept here so the signer and proxy agree. */
export const SIGNATURE_HEADER = 'x-admin-signature';
export const TIMESTAMP_HEADER = 'x-admin-timestamp';
/** Verified key identity forwarded to the route handler (server-internal). */
export const KEY_ID_HEADER = 'x-admin-key-id';

/** Maximum accepted clock skew for `x-admin-timestamp` (both directions). */
export const MAX_AGE_MS = 5 * 60 * 1000;

export type AdminKey = {
  id: string;
  key: KeyObject;
  scopes: ReadonlySet<string>;
  /** Epoch ms, or `null` when the entry has no `expiresAt`. */
  expiresAt: number | null;
};

export type RejectedKey = {
  index: number;
  id?: string;
  reason: string;
};

export type Keyring = {
  keys: AdminKey[];
  rejected: RejectedKey[];
  /** Scope strings that are not part of the vocabulary — kept but grant nothing. */
  unknownScopes: string[];
};

/**
 * Scope vocabulary (see docs/decisions/0007-admin-api-auth.md).
 *
 * `:write` implies `:read`; there is no wildcard. `users:purge` is separate from
 * `users:write` because it is an irreversible hard delete.
 */
const RESOURCE_SCOPES: Record<string, readonly string[]> = {
  organizations: ['read'],
  'feature-flags': ['read', 'write'],
  'plan-features': ['read', 'write'],
  'plan-limits': ['read', 'write'],
  'subscription-plans': ['read', 'write'],
  'user-overrides': ['read', 'write'],
  users: ['read', 'write', 'purge'],
};

/** Every scope name a key may hold. Anything else grants nothing. */
export const KNOWN_SCOPES: ReadonlySet<string> = new Set(
  Object.entries(RESOURCE_SCOPES).flatMap(([resource, kinds]) =>
    kinds.map((kind) => `${resource}:${kind}`),
  ),
);

const API_PREFIX = '/api/v1/';

/**
 * Parse `ADMIN_PEM_KEYS` (JSON array of keyring entries).
 *
 * An empty/blank value means "not configured" — the proxy keeps the dev bypass
 * for that case. A non-empty value that yields zero valid entries is a
 * different thing and fails closed (the proxy decides).
 *
 * Per-entry failures are collected, never thrown: one typo must not brick the
 * whole ring during a rotation.
 */
export function parseKeyring(raw: string): Keyring {
  const keyring: Keyring = { keys: [], rejected: [], unknownScopes: [] };
  if (!raw.trim()) return keyring;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    keyring.rejected.push({
      index: -1,
      reason: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    });
    return keyring;
  }

  if (!Array.isArray(parsed)) {
    keyring.rejected.push({ index: -1, reason: 'expected a JSON array of key entries' });
    return keyring;
  }

  const seenIds = new Set<string>();

  parsed.forEach((entry, index) => {
    const id = isRecord(entry) && typeof entry.id === 'string' ? entry.id : undefined;
    try {
      if (!isRecord(entry)) throw new Error('entry must be an object');

      if (typeof entry.id !== 'string' || !entry.id.trim()) {
        throw new Error('id must be a non-empty string');
      }
      if (seenIds.has(entry.id)) throw new Error(`duplicate id "${entry.id}"`);

      if (typeof entry.key !== 'string' || !entry.key.trim()) {
        throw new Error('key must be a non-empty base64 DER SPKI string');
      }

      if (!Array.isArray(entry.scopes) || entry.scopes.some((s) => typeof s !== 'string')) {
        throw new Error('scopes must be an array of strings');
      }

      let expiresAt: number | null = null;
      if (entry.expiresAt !== undefined && entry.expiresAt !== null) {
        if (typeof entry.expiresAt !== 'string') {
          throw new Error('expiresAt must be an ISO-8601 date/datetime string');
        }
        const parsedExpiry = Date.parse(entry.expiresAt);
        if (Number.isNaN(parsedExpiry)) {
          throw new Error(`expiresAt is not a valid ISO-8601 date: "${entry.expiresAt}"`);
        }
        expiresAt = parsedExpiry;
      }

      const key = createPublicKey({
        key: Buffer.from(entry.key, 'base64'),
        format: 'der',
        type: 'spki',
      });
      if (key.asymmetricKeyType !== 'ed25519') {
        throw new Error(
          `key must be an Ed25519 public key (got ${key.asymmetricKeyType ?? 'unknown'})`,
        );
      }

      const scopes = entry.scopes as string[];
      seenIds.add(entry.id);
      keyring.keys.push({
        id: entry.id,
        key,
        scopes: new Set(scopes),
        expiresAt,
      });

      for (const scope of scopes) {
        if (!KNOWN_SCOPES.has(scope) && !keyring.unknownScopes.includes(scope)) {
          keyring.unknownScopes.push(scope);
        }
      }
    } catch (err) {
      keyring.rejected.push({
        index,
        ...(id ? { id } : {}),
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return keyring;
}

/**
 * Canonical query string: entries sorted by key then value, serialised with
 * `URLSearchParams`. Next normalises the query string before the proxy sees it,
 * so both the signer and the verifier must canonicalise instead of signing the
 * raw URL.
 */
export function canonicalQuery(params: URLSearchParams): string {
  const sorted = [...params.entries()].sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;
    if (aValue === bValue) return 0;
    return aValue < bValue ? -1 : 1;
  });
  return new URLSearchParams(sorted).toString();
}

/** `sha256` hex digest of the exact request body bytes (`sha256("")` when empty). */
export function bodyHash(bytes: ArrayBuffer | Uint8Array): string {
  const buffer =
    bytes instanceof Uint8Array ? Buffer.from(bytes) : Buffer.from(new Uint8Array(bytes));
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Signing payload. Newline-separated so no component can bleed into the next:
 *
 * ```
 * <METHOD>\n<pathname>\n<canonical-query>\n<timestamp-ms>\n<sha256-hex(body)>
 * ```
 */
export function signaturePayload(input: {
  method: string;
  pathname: string;
  query: string;
  timestamp: string;
  bodyHash: string;
}): Buffer {
  return Buffer.from(
    [input.method.toUpperCase(), input.pathname, input.query, input.timestamp, input.bodyHash].join(
      '\n',
    ),
  );
}

/**
 * Scope required to reach `pathname` with `method`; `null` when the path is not
 * a known admin API surface (callers must deny it).
 *
 * `GET`/`HEAD` map to `:read`, everything else to `:write`. The two irreversible
 * user-deletion endpoints require `users:purge` regardless of method.
 */
export function requiredScope(method: string, pathname: string): string | null {
  if (!pathname.startsWith(API_PREFIX)) return null;

  const rest = pathname.slice(API_PREFIX.length).replace(/\/+$/, '');
  if (!rest) return null;

  const [resource, ...segments] = rest.split('/');
  const kinds = RESOURCE_SCOPES[resource];
  if (!kinds) return null;

  if (resource === 'users') {
    const isPurge = segments[0] === 'purge-expired' || segments[1] === 'purge';
    if (isPurge) return 'users:purge';
  }

  const upperMethod = method.toUpperCase();
  const kind = upperMethod === 'GET' || upperMethod === 'HEAD' ? 'read' : 'write';
  return kinds.includes(kind) ? `${resource}:${kind}` : null;
}

/** `:write` implies `:read`; nothing implies `users:purge`; unknown names grant nothing. */
export function hasScope(scopes: ReadonlySet<string>, required: string): boolean {
  if (!KNOWN_SCOPES.has(required)) return false;
  if (scopes.has(required)) return true;
  if (required.endsWith(':read')) {
    return scopes.has(`${required.slice(0, -':read'.length)}:write`);
  }
  return false;
}

/** Return the first configured key that verifies `signatureB64`, or `null`. */
export function verifyAny(
  keys: readonly AdminKey[],
  payload: Buffer,
  signatureB64: string,
): AdminKey | null {
  const signature = Buffer.from(signatureB64, 'base64url');
  if (signature.length === 0) return null;

  for (const candidate of keys) {
    try {
      if (verify(null, payload, candidate.key, signature)) return candidate;
    } catch {
      // A malformed signature must not abort the loop over the ring.
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
