/**
 * #458 — the proxy must honour `?next=` when it redirects an already-signed-in
 * user off `/login`, instead of always sending them to the account-type
 * dashboard. Without this, a reload/retry/back-navigation of the login URL
 * silently drops the deep link.
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
  it('sends a signed-in student to the deep link instead of /app', async () => {
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

  it('falls back to the account-type dashboard for a cross-origin next', async () => {
    signedIn();
    const { location } = await call('/login?next=https://evil.com');
    expect(location).toBe('http://localhost/app');
  });

  it('falls back to the account-type dashboard for a protocol-relative next', async () => {
    signedIn(AccountType.EDUCATOR);
    const { location } = await call('/login?next=//evil.com/x');
    expect(location).toBe('http://localhost/edu');
  });

  it('falls back to the account-type dashboard for a nested login loop', async () => {
    signedIn();
    const { location } = await call('/login?next=/login%3Fnext%3D%2Flogin');
    expect(location).toBe('http://localhost/app');
  });

  // `next=.//evil.com` parses as an internal pathname but normalises to a
  // protocol-relative `//evil.com`; `new URL('//evil.com', request.url)` would
  // redirect off-origin. Must fall back to the dashboard, same origin.
  it('stays same-origin for a normalised protocol-relative next (student)', async () => {
    signedIn();
    const { status, location } = await call('/login?next=.//evil.com');
    expect(status).toBe(307);
    expect(location).toBe('http://localhost/app');
  });

  it('stays same-origin for a normalised protocol-relative next (educator)', async () => {
    signedIn(AccountType.EDUCATOR);
    const { location } = await call('/login?next=/..//evil.com');
    expect(location).toBe('http://localhost/edu');
  });

  // `next` must not bypass role gating: the target re-enters the proxy, so the
  // account-type rule for `/app` runs on the second hop and sends the educator
  // to `/edu`.
  it('account-type precedence wins over the deep link on the second hop', async () => {
    signedIn(AccountType.EDUCATOR);

    const hop1 = await call('/login?next=/app/study/quiz');
    expect(hop1.status).toBe(307);
    expect(hop1.location).toBe('http://localhost/app/study/quiz');

    const hop2 = await call(new URL(hop1.location as string).pathname);
    expect(hop2.status).toBe(307);
    expect(hop2.location).toBe('http://localhost/edu');
  });

  it('keeps the existing dashboard redirect when there is no next', async () => {
    signedIn();
    const { status, location } = await call('/login');
    expect(status).toBe(307);
    expect(location).toBe('http://localhost/app');
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
