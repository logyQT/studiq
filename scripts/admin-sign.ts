#!/usr/bin/env bun
/**
 * Admin PEM signer — repo-owned replacement for the external
 * `admin_podpisz_zadanie.mjs` from the tester pack.
 *
 *   bun scripts/admin-sign.ts gen --id ops-2026-10 --scopes feature-flags:read,users:read [--expires 2027-01-01]
 *   bun scripts/admin-sign.ts sign GET http://localhost:4000/api/v1/feature-flags [--body-file payload.json] [--key-file key.b64]
 *
 * `gen` prints the new keypair and a ready-to-paste `ADMIN_PEM_KEYS` line; it
 * writes nothing to disk. `sign` reads the private key from
 * `ADMIN_PEM_PRIVATE_KEY` (base64 PKCS8 DER) or `--key-file`.
 *
 * The payload/scope code is imported from the gate itself, so the signer and the
 * proxy can never drift apart.
 */
import { createPrivateKey, generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  canonicalQuery,
  bodyHash,
  KEY_ID_HEADER,
  KNOWN_SCOPES,
  MAX_AGE_MS,
  requiredScope,
  SIGNATURE_HEADER,
  signaturePayload,
  TIMESTAMP_HEADER,
} from '@admin/lib/admin-pem';

const DEFAULT_EXPIRY_DAYS = 90;

type RingEntry = {
  id: string;
  key: string;
  scopes: string[];
  expiresAt?: string;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/admin-sign.ts gen --id <key-id> --scopes <scope,scope> [--expires YYYY-MM-DD]
  bun scripts/admin-sign.ts sign <METHOD> <URL> [--body-file <path>] [--key-file <path>]

Generate a keypair:
  gen --id ops-2026-10 --scopes feature-flags:read,users:read

Sign a request (private key from ADMIN_PEM_PRIVATE_KEY or --key-file):
  sign GET http://localhost:4000/api/v1/feature-flags
  sign POST http://localhost:4000/api/v1/feature-flags --body-file flag.json

Known scopes: ${[...KNOWN_SCOPES].sort().join(', ')}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [flag, inline] = arg.slice(2).split('=', 2);
    if (inline !== undefined) {
      flags.set(flag, inline);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Missing value for --${flag}`);
    }
    flags.set(flag, next);
    i += 1;
  }

  return { positional, flags };
}

function generate(args: { flags: Map<string, string> }): void {
  const id = args.flags.get('id')?.trim();
  if (!id) throw new Error('gen requires --id <key-id>');

  const scopes = (args.flags.get('scopes') ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (scopes.length === 0) throw new Error('gen requires --scopes <scope,scope>');

  const unknown = scopes.filter((scope) => !KNOWN_SCOPES.has(scope));
  if (unknown.length > 0) {
    console.error(`⚠ Unknown scope(s) — these will grant nothing: ${unknown.join(', ')}`);
  }

  const expires = args.flags.get('expires')?.trim();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  const privateKeyB64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const publicKeyB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

  const entry: RingEntry = { id, key: publicKeyB64, scopes };
  if (expires) entry.expiresAt = expires;

  const suggestedExpiry = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  console.log('# Private key — store it in ADMIN_PEM_PRIVATE_KEY or a gitignored file.');
  console.log('# It is printed once and cannot be recovered.');
  console.log(`ADMIN_PEM_PRIVATE_KEY=${privateKeyB64}`);
  console.log('');
  console.log('# Ring entry (add to the ADMIN_PEM_KEYS JSON array, single-quoted in .env):');
  console.log(JSON.stringify(entry));
  console.log('');
  console.log('# Ready-to-paste .env line for a single-key ring:');
  console.log(`ADMIN_PEM_KEYS='${JSON.stringify([entry])}'`);
  console.log('');
  if (!expires) {
    console.log(`# Suggested expiresAt (${DEFAULT_EXPIRY_DAYS} days): ${suggestedExpiry}`);
    console.log('# Pass --expires to include it in the ring entry and bound the key lifetime.');
  }
}

function readPrivateKey(flags: Map<string, string>): KeyObject {
  const inline = process.env.ADMIN_PEM_PRIVATE_KEY?.trim();
  const keyFile = flags.get('key-file');

  if (inline && keyFile) {
    throw new Error('Provide either ADMIN_PEM_PRIVATE_KEY or --key-file, not both');
  }

  const encoded = keyFile ? readFileSync(keyFile, 'utf8').trim() : inline;
  if (!encoded) {
    throw new Error('No private key: set ADMIN_PEM_PRIVATE_KEY or pass --key-file <path>');
  }

  return createPrivateKey({ key: Buffer.from(encoded, 'base64'), format: 'der', type: 'pkcs8' });
}

function signRequest(positional: string[], flags: Map<string, string>): void {
  const [method, rawUrl] = positional;
  if (!method || !rawUrl) throw new Error('sign requires <METHOD> <URL>');

  const url = new URL(rawUrl);
  const bodyFile = flags.get('body-file');
  const body = bodyFile ? new Uint8Array(readFileSync(bodyFile)) : new Uint8Array(0);

  const timestamp = Date.now().toString();
  const payload = signaturePayload({
    method,
    pathname: url.pathname,
    query: canonicalQuery(url.searchParams),
    timestamp,
    bodyHash: bodyHash(body),
  });

  const signature = sign(null, payload, readPrivateKey(flags)).toString('base64url');

  const required = requiredScope(method, url.pathname);
  if (!required) {
    console.error(
      `⚠ ${method} ${url.pathname} is not a known admin API path — the gate will deny it`,
    );
  }

  console.log(`${SIGNATURE_HEADER}: ${signature}`);
  console.log(`${TIMESTAMP_HEADER}: ${timestamp}`);
  console.log('');
  console.log('# curl');
  const curlBody = bodyFile ? ` \\\n  --data-binary @${bodyFile}` : '';
  console.log(
    `curl -i -X ${method.toUpperCase()} '${rawUrl}' \\\n  -H '${SIGNATURE_HEADER}: ${signature}' \\\n  -H '${TIMESTAMP_HEADER}: ${timestamp}'${curlBody}`,
  );
  if (required) {
    console.log('');
    console.log(`# Required scope: ${required}`);
    console.log(`# Timestamp window: ±${MAX_AGE_MS / 60_000} minutes`);
  }
  console.log('');
  console.log(`# The proxy forwards the verified key id as ${KEY_ID_HEADER}.`);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') usage();

  const { positional, flags } = parseArgs(rest);
  if (command === 'gen') {
    generate({ flags });
    return;
  }
  if (command === 'sign') {
    signRequest(positional, flags);
    return;
  }
  usage();
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
