import { AccountType } from '@studiq/authz';
import { routeRules } from '@studiq/server/config/routes.config';
import { authGuard } from '@studiq/server/guards/auth.guard';
import { roleGuard } from '@studiq/server/guards/role.guard';
import { updateSession } from '@studiq/server/lib/supabase/session';
import { type NextRequest, NextResponse } from 'next/server';
import { toSafeInternalPath } from '@/lib/safe-redirect';

function preserveCookies(originalResponse: NextResponse, newResponse: NextResponse) {
  originalResponse.cookies.getAll().forEach((cookie) => {
    newResponse.cookies.set(cookie.name, cookie.value);
  });
  return newResponse;
}

/**
 * The JWT's `app_metadata.account_type` is untyped at the Supabase boundary; only
 * the three known account types are honoured.
 *
 * This is **not** an authorization input: the area routes are auth-only, so the
 * proxy never asks what a caller's persona is. The only rules that still name an
 * account type are the declared onboarding exceptions (`/setup/org` MANAGER,
 * `/setup` EDUCATOR, ADR-0015 §7), and they need the value narrowed to compare.
 */
function resolveAccountType(jwtAccountType: unknown): AccountType | undefined {
  if (
    jwtAccountType === AccountType.MANAGER ||
    jwtAccountType === AccountType.EDUCATOR ||
    jwtAccountType === AccountType.STUDENT
  ) {
    return jwtAccountType;
  }
  return undefined;
}

export async function proxy(request: NextRequest) {
  // API routes authenticate themselves with `withAuth()` (or are declared open
  // in `PUBLIC_API`, routes.config.ts); the proxy never gates `/api/*`.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const { user, response: supabaseResponse } = await updateSession(request);
  const path = request.nextUrl.pathname;

  const matchedRule = routeRules.find((rule) => rule.matcher.test(path));

  // 1. If no rule matches, let the request pass through (public route)
  if (!matchedRule) {
    return supabaseResponse;
  }

  const accountType = resolveAccountType(user?.app_metadata.account_type);

  // 2. Handle "Redirect if Authenticated" (e.g., /login -> /dashboard)
  if (user) {
    // A signed-in user opening `/login?next=<path>` (a reload, a retry, or a
    // back-navigation after logging in) must land on the deep link, not the
    // landing page — otherwise the `?next=` target is silently dropped (#458).
    const safeNext = toSafeInternalPath(request.nextUrl.searchParams.get('next'), request.url);

    if (matchedRule.redirectIfAuthenticated) {
      const url = new URL(safeNext ?? matchedRule.redirectIfAuthenticated, request.url);
      return preserveCookies(supabaseResponse, NextResponse.redirect(url));
    }
  }

  // 3. Handle Authentication Requirement
  if (matchedRule.requireAuth && !authGuard(user)) {
    const loginUrl = new URL('/login', request.url);
    // Keep the query string: a signed-out `/app/study/quiz?type=open` must
    // come back to that exact URL after login. Re-validated by
    // `toSafeInternalPath` on the way in and on the login page.
    loginUrl.searchParams.set('next', `${path}${request.nextUrl.search}`);
    return preserveCookies(supabaseResponse, NextResponse.redirect(loginUrl));
  }

  // 4. Handle Account Type Access Control — onboarding exceptions only.
  if (matchedRule.allowedAccountTypes && matchedRule.allowedAccountTypes.length > 0) {
    if (!roleGuard(accountType, matchedRule.allowedAccountTypes)) {
      // The neutral landing resolves the area from the active org's permissions;
      // a persona-shaped fallback here would be a second authority source.
      const fallbackUrl = new URL('/dashboard', request.url);
      return preserveCookies(supabaseResponse, NextResponse.redirect(fallbackUrl));
    }
  }

  // 5. If all checks pass, proceed
  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
