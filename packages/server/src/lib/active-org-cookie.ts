import type { NextResponse } from 'next/server';

export const ACTIVE_ORG_COOKIE = 'active_org_id';

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

/**
 * Server-only tenant hint (#186). The client never reads it — the active org is
 * served by `GET /api/v1/me/orgs` (`isActive`). `withAuth` only honours the value
 * when the caller holds an `org_members` row for that org.
 *
 * NOTE: the flags are kept apart from the lifetime on purpose. Next re-parses every
 * `Set-Cookie` header (`ResponseCookies` -> `parseSetCookie` -> `compact()`) whenever
 * the handler also mutates `cookies()` — which `supabase.auth.signOut()` does on
 * logout — and `compact()` drops falsy values, including `maxAge: 0`. A deletion
 * expressed as `maxAge: 0` therefore degrades into an undated session cookie that the
 * browser keeps. `delete()` emits `Expires=Thu, 01 Jan 1970`, which is truthy and
 * survives the round-trip.
 */
const ACTIVE_ORG_COOKIE_FLAGS = {
  path: '/',
  sameSite: 'lax' as const,
  httpOnly: true,
};

export function setActiveOrgCookie(res: NextResponse, orgId: string): NextResponse {
  res.cookies.set(ACTIVE_ORG_COOKIE, orgId, {
    ...ACTIVE_ORG_COOKIE_FLAGS,
    maxAge: ONE_YEAR_IN_SECONDS,
  });
  return res;
}

export function clearActiveOrgCookie(res: NextResponse): NextResponse {
  // `delete()` == set('', { ...flags, expires: new Date(0) }) and keeps HttpOnly /
  // SameSite / Path so the browser matches the cookie it is deleting. Never add a
  // `maxAge` here: `normalizeCookie()` lets `maxAge` win over `expires`, which would
  // push the expiry a year into the future instead of deleting the cookie.
  res.cookies.delete({ name: ACTIVE_ORG_COOKIE, ...ACTIVE_ORG_COOKIE_FLAGS });
  return res;
}
