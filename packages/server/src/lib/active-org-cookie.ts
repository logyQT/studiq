import type { NextResponse } from 'next/server';

export const ACTIVE_ORG_COOKIE = 'active_org_id';

/**
 * Server-only tenant hint (#186). The client never needs to read it — the active
 * organisation is served by `GET /api/v1/me/orgs` (`isActive`). `withAuth` only
 * honours the value when the caller holds an `org_members` row for that org.
 */
const ACTIVE_ORG_COOKIE_OPTIONS = {
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax' as const,
  httpOnly: true,
};

export function setActiveOrgCookie(res: NextResponse, orgId: string): NextResponse {
  res.cookies.set(ACTIVE_ORG_COOKIE, orgId, ACTIVE_ORG_COOKIE_OPTIONS);
  return res;
}

export function clearActiveOrgCookie(res: NextResponse): NextResponse {
  res.cookies.set(ACTIVE_ORG_COOKIE, '', { ...ACTIVE_ORG_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
