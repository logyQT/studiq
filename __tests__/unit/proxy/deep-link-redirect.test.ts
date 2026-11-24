/**
 * #458 — the proxy must honour `?next=` when it redirects an already-signed-in
 * user off `/login`, instead of always sending them to the landing page. Without
 * this, a reload/retry/back-navigation of the login URL silently drops the deep
 * link.
 *
 * `?next=` rejection falls back to `/dashboard`: since ADR-0015 §7.1 the proxy
 * cannot name an area (which one is home is a function of the active org's
 * permissions), so it never guesses one.
 */
import { AccountType } from '@studiq/authz';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateSession = vi.fn();

vi.mock('@studiq/server/lib/supabase/session', () => ({ updateSession }));

const { proxy } = await import('@/proxy');

type SessionUser = { app_metadata: { account_type: string } } | null;

function signedIn(accountType: AccountType = AccountType.STUDENT) {
  updateSession.mockResolvedValue({
    user: { app_metadata: { account_type: accountType } } as SessionUser,
    response: NextResponse.next(),
    supabase: {},
  });
}

function signedOut() {
  updateSession.mockResolvedValue({
    user: null,
    response: NextResponse.next(),
    supabase: {},
  });
}

async function call(path: string, base = 'http://localhost') {
  const res = await proxy(new NextRequest(new URL(path, base)));
  return { status: res.status, location: res.headers.get('location') };
}

beforeEach(() => {
  updateSession.mockReset();
});

describe('proxy — ?next= deep link (#458)', () => {
  it('sends a signed-in student to the deep link instead of the landing page', async () => {
    signedIn();
    const { status, location } = await call('/login?next=/app/study/quiz');
    expect(status).toBe(307);
    expect(location).toBe('http://localhost/app/study/quiz');
  });

  it('preserves the deep link query string', async () => {
    signedIn();
    const { location } = await call('/login?next=%2Fapp%2Fstudy%2Fquiz%3Ftype%3Dopen');
    expect(location).toBe('http://localhost/app/study/quiz?type=open');
  });

  it('falls back to the landing page for a cross-origin next', async () => {
    signedIn();
    const { location } = await call('/login?next=https://evil.com');
    expect(location).toBe('http://localhost/dashboard');
  });

  it('falls back to the landing page for a protocol-relative next', async () => {
    signedIn(AccountType.EDUCATOR);
    const { location } = await call('/login?next=//evil.com/x');
    expect(location).toBe('http://localhost/dashboard');
  });

  it('falls back to the landing page for a nested login loop', async () => {
    signedIn();
    const { location } = await call('/login?next=/login%3Fnext%3D%2Flogin');
    expect(location).toBe('http://localhost/dashboard');
  });

  // `next=.//evil.com` parses as an internal pathname but normalises to a
  // protocol-relative `//evil.com`; `new URL('//evil.com', request.url)` would
  // redirect off-origin. Must fall back to the landing page, same origin.
  it('stays same-origin for a normalised protocol-relative next (student)', async () => {
    signedIn();
    const { status, location } = await call('/login?next=.//evil.com');
    expect(status).toBe(307);
    expect(location).toBe('http://localhost/dashboard');
  });

  it('stays same-origin for a normalised protocol-relative next (educator)', async () => {
    signedIn(AccountType.EDUCATOR);
    const { location } = await call('/login?next=/..//evil.com');
    expect(location).toBe('http://localhost/dashboard');
  });

  // The area routes are auth-only (ADR-0015 §7.1), so the second hop renders
  // the deep link instead of re-gating it: a link is navigation, the API is the
  // boundary, and an educator opening `/app` gets that page (its own reads still
  // decide) rather than a redirect back to `/edu`.
  it('the deep link is not re-gated: area routes are auth-only', async () => {
    signedIn(AccountType.EDUCATOR);

    const hop1 = await call('/login?next=/app/study/quiz');
    expect(hop1.status).toBe(307);
    expect(hop1.location).toBe('http://localhost/app/study/quiz');

    if (!hop1.location) throw new Error('expected a redirect location');
    const hop2 = await call(new URL(hop1.location).pathname);
    expect(hop2.status).toBe(200);
    expect(hop2.location).toBeNull();
  });

  it('keeps the neutral landing redirect when there is no next', async () => {
    signedIn();
    const { status, location } = await call('/login');
    expect(status).toBe(307);
    expect(location).toBe('http://localhost/dashboard');
  });

  it('signed-out deep link still bounces through /login with next preserved', async () => {
    signedOut();
    const { status, location } = await call('/app/study/quiz');
    expect(status).toBe(307);
    expect(location).toBe('http://localhost/login?next=%2Fapp%2Fstudy%2Fquiz');
  });

  it('signed-out deep link keeps its query string in next', async () => {
    signedOut();
    const { status, location } = await call('/app/study/quiz?type=open');
    expect(status).toBe(307);
    expect(location).toBe('http://localhost/login?next=%2Fapp%2Fstudy%2Fquiz%3Ftype%3Dopen');
  });
});

describe('proxy — the onboarding persona exceptions (ADR-0015 §7, §7.1)', () => {
  // `/setup/org` (MANAGER) and `/setup` (EDUCATOR) are the only rules that still
  // name an account type — the declared onboarding exceptions. Everything else
  // is auth-only, and a denial lands on `/dashboard`, never on an area: which
  // area is home is the active org's permissions, which the proxy cannot read.
  it('bounces a manager from /setup to the landing page, not to /manage', async () => {
    signedIn(AccountType.MANAGER);
    const { status, location } = await call('/setup');
    expect(status).toBe(307);
    expect(location).toBe('http://localhost/dashboard');
  });

  it('bounces an educator from /setup/org to the landing page, not to /edu', async () => {
    signedIn(AccountType.EDUCATOR);
    const { status, location } = await call('/setup/org');
    expect(status).toBe(307);
    expect(location).toBe('http://localhost/dashboard');
  });

  it('lets an educator open /setup', async () => {
    signedIn(AccountType.EDUCATOR);
    const { status, location } = await call('/setup');
    expect(status).toBe(200);
    expect(location).toBeNull();
  });

  it('lets a manager open /setup/org', async () => {
    signedIn(AccountType.MANAGER);
    const { status, location } = await call('/setup/org');
    expect(status).toBe(200);
    expect(location).toBeNull();
  });

  it('keeps /dashboard behind auth with the landing as the ?next= target', async () => {
    signedOut();
    const { status, location } = await call('/dashboard');
    expect(status).toBe(307);
    expect(location).toBe('http://localhost/login?next=%2Fdashboard');
  });
});

describe('proxy — /checkout requires auth (#225)', () => {
  const checkout =
    '/checkout?session_id=131bad5e-0f00-496b-83d2-03ce408f55f0&plan_id=hub&org_id=00000000-0000-4000-8000-000000000001';

  it('bounces a signed-out org checkout through /login and keeps the full URL', async () => {
    signedOut();
    const { status, location } = await call(checkout);

    expect(status).toBe(307);
    if (!location) throw new Error('expected a redirect location');
    const login = new URL(location);
    expect(login.pathname).toBe('/login');
    // The org id is what the page resolves the target organization from, so it
    // must survive the login round-trip.
    expect(login.searchParams.get('next')).toBe(checkout);
  });

  it('lets a signed-in manager straight through', async () => {
    signedIn(AccountType.MANAGER);
    const { status, location } = await call(checkout);

    expect(status).toBe(200);
    expect(location).toBeNull();
  });
});
