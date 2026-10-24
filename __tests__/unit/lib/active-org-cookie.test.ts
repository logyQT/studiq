import {
  ACTIVE_ORG_COOKIE,
  clearActiveOrgCookie,
  setActiveOrgCookie,
} from '@studiq/server/lib/active-org-cookie';
import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { NEXT_COOKIE_EPOCH, reSerializeThroughNext } from '#test/helpers/next-cookie-round-trip';

describe('active-org-cookie (#186)', () => {
  it('writes a server-only (HttpOnly) active_org_id cookie', () => {
    const res = setActiveOrgCookie(new NextResponse(), 'org-1');
    const header = res.headers.get('set-cookie');

    expect(ACTIVE_ORG_COOKIE).toBe('active_org_id');
    expect(res.cookies.get('active_org_id')?.value).toBe('org-1');
    expect(header).toContain('active_org_id=org-1');
    expect(header).toContain('Max-Age=31536000');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=lax');
    expect(header).toContain('Path=/');
  });

  it('deletes the cookie with a past Expires while keeping the security flags', () => {
    const res = clearActiveOrgCookie(new NextResponse());
    const header = res.headers.get('set-cookie');

    expect(res.cookies.get('active_org_id')?.value).toBe('');
    expect(header).toContain('active_org_id=;');
    expect(header).toContain(NEXT_COOKIE_EPOCH);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=lax');
    expect(header).toContain('Path=/');
    // A `maxAge` would win over `expires` in Next's `normalizeCookie()` and push the
    // expiry a year into the future, so the clear path must not set one.
    expect(header).not.toContain('Max-Age');
  });

  it('keeps the deletion after Next re-serializes the Set-Cookie headers', () => {
    // Regression guard for the r1 bug: `maxAge: 0` is dropped by Next's cookie
    // round-trip (compact()), leaving an empty *session* cookie that survives logout.
    const headers = reSerializeThroughNext(clearActiveOrgCookie(new NextResponse()));
    const header = headers.find((cookie) => cookie.startsWith('active_org_id'));

    expect(header).toBeDefined();
    expect(header).toContain('active_org_id=;');
    expect(header).toContain(NEXT_COOKIE_EPOCH);
    expect(header).not.toContain('Max-Age');
  });
});
