/**
 * Test-only helpers for the admin PEM gate: key generation, ring building and
 * request signing.
 *
 * The signer lives here (not in the production `scripts/admin-sign.ts`) so unit
 * and E2E tests can generate throwaway keypairs. Both use the exact payload
 * implementation from `@admin/lib/admin-pem`, so a test can never pass against a
 * payload the proxy would not accept.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
} from 'node:crypto';
import {
  bodyHash,
  canonicalQuery,
  SIGNATURE_HEADER,
  signaturePayload,
  TIMESTAMP_HEADER,
} from '@admin/lib/admin-pem';

export type AdminTestKey = {
  id: string;
  privateKey: KeyObject;
  /** base64 DER SPKI, the encoding `ADMIN_PEM_KEYS` expects. */
  publicKeyB64: string;
};

export type RingEntryOptions = {
  scopes?: string[];
  expiresAt?: string;
};

/** Fresh Ed25519 keypair for a single test. */
export function createAdminTestKey(id: string): AdminTestKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    id,
    privateKey,
    publicKeyB64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

/**
 * Deterministic Ed25519 keypair for the Playwright project.
 *
 * Derived from a fixed seed so the `webServer` process (which builds the ring
 * from `ADMIN_PEM_KEYS`) and the test worker agree without committing a secret.
 * PKCS8 for Ed25519 is the fixed `302e020100300506032b657004220420` prefix
 * followed by the 32-byte seed.
 */
export function deterministicAdminTestKey(id = 'e2e-admin'): AdminTestKey {
  const seed = createHash('sha256').update('studiq-admin-e2e').digest();
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  return {
    id,
    privateKey,
    publicKeyB64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

/** One entry in the `ADMIN_PEM_KEYS` JSON array. */
export function ringEntry(
  key: AdminTestKey,
  options: RingEntryOptions = {},
): { id: string; key: string; scopes: string[]; expiresAt?: string } {
  return {
    id: key.id,
    key: key.publicKeyB64,
    scopes: options.scopes ?? [],
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
  };
}

/** Serialise ring entries exactly as `ADMIN_PEM_KEYS` expects. */
export function ringJson(
  entries: Array<{ id: string; key: string; scopes: string[]; expiresAt?: string }>,
): string {
  return JSON.stringify(entries);
}

export type SignRequestInput = {
  key: AdminTestKey;
  url: string;
  method?: string;
  /** Raw body bytes/string — must match what the request actually sends. */
  body?: string | Uint8Array;
  /** Epoch ms; defaults to now. */
  timestamp?: number;
};

/** Build the two signature headers for a request. */
export function signAdminRequest(input: SignRequestInput): Record<string, string> {
  const method = (input.method ?? 'GET').toUpperCase();
  const url = new URL(input.url, 'http://localhost:4000');
  const body =
    typeof input.body === 'string' || input.body === undefined
      ? new TextEncoder().encode(input.body ?? '')
      : input.body;
  const timestamp = String(input.timestamp ?? Date.now());

  const payload = signaturePayload({
    method,
    pathname: url.pathname,
    query: canonicalQuery(url.searchParams),
    timestamp,
    bodyHash: bodyHash(body),
  });

  return {
    [SIGNATURE_HEADER]: sign(null, payload, input.key.privateKey).toString('base64url'),
    [TIMESTAMP_HEADER]: timestamp,
  };
}
