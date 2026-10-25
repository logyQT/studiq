import {
  bodyHash,
  canonicalQuery,
  hasScope,
  KEY_ID_HEADER,
  type Keyring,
  parseKeyring,
  requiredScope,
  SIGNATURE_HEADER,
  signaturePayload,
  TIMESTAMP_HEADER,
  MAX_AGE_MS,
  verifyAny,
} from '@admin/lib/admin-pem';
import { error, log, warn } from '@studiq/server/lib/log';
import { type NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Key loading — called once per cold start, cached in module scope.
//
// The ring is parsed lazily (not at import time) so unit tests can set
// `ADMIN_PEM_KEYS` before the first request, and so a malformed entry is
// skipped-and-logged instead of throwing during module evaluation.
// ---------------------------------------------------------------------------

let cached: { raw: string; keyring: Keyring } | null = null;

function loadKeyring(): { raw: string; keyring: Keyring } {
  if (cached) return cached;

  const raw = process.env.ADMIN_PEM_KEYS ?? '';
  const keyring = parseKeyring(raw);
  cached = { raw, keyring };

  for (const rejected of keyring.rejected) {
    warn('admin_pem_key_rejected', {
      index: rejected.index,
      key_id: rejected.id,
      reason: rejected.reason,
    });
  }
  if (keyring.unknownScopes.length > 0) {
    warn('admin_pem_unknown_scopes', { scopes: keyring.unknownScopes.join(',') });
  }
  if (raw.trim() && keyring.keys.length === 0) {
    // Non-empty config that parsed to nothing → fail closed in every environment.
    error('admin_pem_keyring_empty', {
      rejected: keyring.rejected.length,
    });
  }

  return cached;
}

function unauthorized(): NextResponse {
  return NextResponse.json({ success: false, error: 'ERROR_UNAUTHORIZED' }, { status: 401 });
}

function forbidden(): NextResponse {
  return NextResponse.json({ success: false, error: 'ERROR_FORBIDDEN' }, { status: 403 });
}

// ---------------------------------------------------------------------------
// Proxy — Next.js 16 middleware
// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Static assets & _next — always allow
  if (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp)$/)
  ) {
    return NextResponse.next();
  }

  // UI pages — pass through (the panel is client-only; the API is the boundary)
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // --- API routes: PEM gate --------------------------------------------------

  const { raw, keyring } = loadKeyring();

  // Not configured → keep the historical dev bypass, fail closed in production.
  if (!raw.trim()) {
    return process.env.NODE_ENV === 'production' ? unauthorized() : NextResponse.next();
  }

  // Configured but nothing valid parsed → fail closed in every environment.
  if (keyring.keys.length === 0) {
    return unauthorized();
  }

  const signature = request.headers.get(SIGNATURE_HEADER);
  const timestamp = request.headers.get(TIMESTAMP_HEADER);

  if (!signature || !timestamp) {
    return unauthorized();
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_AGE_MS) {
    return unauthorized();
  }

  // Next buffers the proxy request body, so this does not steal the body from
  // the route handler (see proxyClientMaxBodySize docs).
  const body = await request.arrayBuffer();
  const payload = signaturePayload({
    method: request.method,
    pathname,
    query: canonicalQuery(request.nextUrl.searchParams),
    timestamp,
    bodyHash: bodyHash(body),
  });

  const matched = verifyAny(keyring.keys, payload, signature);
  if (!matched) {
    return forbidden();
  }

  if (matched.expiresAt !== null && matched.expiresAt < Date.now()) {
    warn('admin_api_denied', {
      key_id: matched.id,
      method: request.method,
      path: pathname,
      reason: 'expired',
      status: 401,
    });
    return unauthorized();
  }

  const required = requiredScope(request.method, pathname);
  if (!required) {
    warn('admin_api_denied', {
      key_id: matched.id,
      method: request.method,
      path: pathname,
      reason: 'unknown_path',
      status: 403,
    });
    return forbidden();
  }

  if (!hasScope(matched.scopes, required)) {
    warn('admin_api_denied', {
      key_id: matched.id,
      method: request.method,
      path: pathname,
      reason: 'scope',
      required_scope: required,
      status: 403,
    });
    return forbidden();
  }

  log('admin_api_request', {
    key_id: matched.id,
    method: request.method,
    path: pathname,
    decision: 'allow',
  });

  // Attribution is server-owned: drop any inbound value before setting ours.
  const headers = new Headers(request.headers);
  headers.delete(KEY_ID_HEADER);
  headers.set(KEY_ID_HEADER, matched.id);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
