import {
  ACTIVE_ORG_COOKIE,
  clearActiveOrgCookie,
  setActiveOrgCookie,
} from '@studiq/server/lib/active-org-cookie';
import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

describe('active-org-cookie (#186)', () => {
  it('writes a server-only (HttpOnly) active_org_id cookie', () => {
    const res = setActiveOrgCookie(new NextResponse(), 'org-1');
    const header = res.headers.get('set-cookie');

    expect(ACTIVE_ORG_COOKIE).toBe('active_org_id');
    expect(res.cookies.get('active_org_id')?.value).toBe('org-1');
    expect(header).toContain('active_org_id=org-1');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=lax');
    expect(header).toContain('Path=/');
  });

  it('clears the cookie with Max-Age=0 while keeping the security flags', () => {
    const res = clearActiveOrgCookie(new NextResponse());
    const header = res.headers.get('set-cookie');

    expect(res.cookies.get('active_org_id')?.value).toBe('');
    expect(header).toContain('active_org_id=;');
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=lax');
    expect(header).toContain('Path=/');
  });
});
