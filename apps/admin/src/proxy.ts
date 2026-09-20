import { createPublicKey, type KeyObject, verify } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';

const SIGNATURE_HEADER = 'x-admin-signature';
const TIMESTAMP_HEADER = 'x-admin-timestamp';
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Key loading — called once per cold start, cached in module scope
// ---------------------------------------------------------------------------

let cachedKeys: KeyObject[] | null = null;

function loadPublicKeys(): KeyObject[] {
  if (cachedKeys) return cachedKeys;

  const raw = process.env.ADMIN_PEM_KEYS ?? '';
  if (!raw.trim()) {
    // No keys configured — reject everything (fail-closed)
    cachedKeys = [];
    return cachedKeys;
  }

  cachedKeys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((b64) => {
      const der = Buffer.from(b64, 'base64');
      return createPublicKey({ key: der, format: 'der', type: 'spki' });
    });

  return cachedKeys;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

function verifySignature(keys: KeyObject[], payload: Buffer, signatureB64: string): boolean {
  const sig = Buffer.from(signatureB64, 'base64url');
  return keys.some((key) => verify(null, payload, key, sig));
}

// ---------------------------------------------------------------------------
// Proxy — Next.js 16 middleware
// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Static assets & _next — always allow
  if (
    path.startsWith('/_next/') ||
    path === '/favicon.ico' ||
    path.match(/\.(svg|png|jpg|jpeg|gif|webp)$/)
  ) {
    return NextResponse.next();
  }

  // UI pages — pass through (C6 adds i18n; C5 doesn't gate these)
  if (!path.startsWith('/api/')) {
    return NextResponse.next();
  }

  // --- API routes: PEM gate --------------------------------------------------

  const keys = loadPublicKeys();

  // No keys configured → allow all in development (admin app is trusted)
  if (keys.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.next();
    }
    return NextResponse.json({ success: false, error: 'ERROR_UNAUTHORIZED' }, { status: 401 });
  }

  const signature = request.headers.get(SIGNATURE_HEADER);
  const timestamp = request.headers.get(TIMESTAMP_HEADER);

  if (!signature || !timestamp) {
    return NextResponse.json({ success: false, error: 'ERROR_UNAUTHORIZED' }, { status: 401 });
  }

  const ts = Number(timestamp);
  if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > MAX_AGE_MS) {
    return NextResponse.json({ success: false, error: 'ERROR_UNAUTHORIZED' }, { status: 401 });
  }

  // Sign over: "<method> <path> <timestamp>"
  const payload = Buffer.from(`${request.method} ${path} ${timestamp}`);

  if (!verifySignature(keys, payload, signature)) {
    return NextResponse.json({ success: false, error: 'ERROR_FORBIDDEN' }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
