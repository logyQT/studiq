import { NextResponse } from 'next/server';

/**
 * Reproduces Next's cookie re-serialization for a route-handler response.
 *
 * When a handler both returns `Set-Cookie` headers *and* mutates `cookies()`,
 * Next runs `appendMutableCookies()`
 * (`next/dist/server/route-modules/app-route/module.js`), which parses every
 * returned `Set-Cookie` header through `ResponseCookies` / `parseSetCookie()` and
 * re-serializes the result. `parseSetCookie()` ends with `compact()`, which drops
 * falsy values — so a deletion expressed as `maxAge: 0` degrades into an undated
 * session cookie that no browser removes.
 *
 * `supabase.auth.signOut()` deletes the `sb-*` cookies through `cookies()` on
 * logout, so that is exactly the path the `active_org_id` deletion takes (#186).
 *
 * The helper mirrors the same public-API round-trip: parse the handler's cookies,
 * add a mutation (standing in for the Supabase deletions) so the re-serialization
 * is triggered, and return the resulting `Set-Cookie` headers. Built only on
 * `next/server` (`NextResponse` / `Headers`) — no deep imports.
 */
export function reSerializeThroughNext(res: NextResponse): string[] {
  const headers = new Headers();
  for (const cookie of res.headers.getSetCookie()) headers.append('set-cookie', cookie);

  const parsed = new NextResponse('{}', { headers }).cookies.getAll();

  const out = new NextResponse('{}');
  out.cookies.set({ name: 'sb-localhost-auth-token', value: '', path: '/', maxAge: 0 });
  for (const cookie of parsed) out.cookies.set(cookie);
  return out.headers.getSetCookie();
}

export const NEXT_COOKIE_EPOCH = 'Expires=Thu, 01 Jan 1970';
