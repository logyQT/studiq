import { type NextRequest, NextResponse } from 'next/server';

/**
 * Minimal proxy for the admin app.
 *
 * C5 will add PEM-gated Ed25519 header signature verification here.
 * For now this is a passthrough — the admin app is internal-only
 * and served on a separate port/subdomain.
 */
export async function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
