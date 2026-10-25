import { AccountType } from '@studiq/authz';
import { routeRules } from '@studiq/server/config/routes.config';
import { authGuard } from '@studiq/server/guards/auth.guard';
import { roleGuard } from '@studiq/server/guards/role.guard';
import { APP_ERRORS } from '@studiq/server/lib/errors';
import { updateSession } from '@studiq/server/lib/supabase/session';
import { type NextRequest, NextResponse } from 'next/server';
import { toSafeInternalPath } from '@/lib/safe-redirect';

const ACCOUNT_TYPE_REDIRECTS: Record<string, string> = {
  [AccountType.MANAGER]: '/manage',
  [AccountType.EDUCATOR]: '/edu',
  [AccountType.STUDENT]: '/app',
};

function preserveCookies(originalResponse: NextResponse, newResponse: NextResponse) {
  originalResponse.cookies.getAll().forEach((cookie) => {
    newResponse.cookies.set(cookie.name, cookie.value);
  });
  return newResponse;
}

function resolveAccountType(jwtAccountType: AccountType | undefined): AccountType {
  return jwtAccountType ?? AccountType.STUDENT;
}

export async function proxy(request: NextRequest) {
  // API routes handle auth internally via withAuth() — skip middleware to avoid double getUser()
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

  const accountType = resolveAccountType(
    user?.app_metadata?.account_type as AccountType | undefined,
  );

  // 2. Handle "Redirect if Authenticated" (e.g., /login -> /dashboard)
  if (user) {
    // A signed-in user opening `/login?next=<path>` (a reload, a retry, or a
    // back-navigation after logging in) must land on the deep link, not the
    // dashboard — otherwise the `?next=` target is silently dropped (#458).
    // Validated once here; the account-type rule below still applies to the
    // target because the redirect goes through the proxy again.
    const safeNext = toSafeInternalPath(request.nextUrl.searchParams.get('next'), request.url);

    if (matchedRule.redirectIfAuthenticatedByAccountType) {
      const destination = safeNext ?? matchedRule.redirectIfAuthenticatedByAccountType[accountType];

      if (destination) {
        const url = new URL(destination, request.url);
        return preserveCookies(supabaseResponse, NextResponse.redirect(url));
      }
    }

    if (matchedRule.redirectIfAuthenticated) {
      const url = new URL(safeNext ?? matchedRule.redirectIfAuthenticated, request.url);
      return preserveCookies(supabaseResponse, NextResponse.redirect(url));
    }
  }

  // 3. Handle Authentication Requirement
  if (matchedRule.requireAuth && !authGuard(user)) {
    if (matchedRule.isApi) {
      const res = NextResponse.json(
        { success: false, error: APP_ERRORS.UNAUTHORIZED.code },
        { status: 401 },
      );
      return preserveCookies(supabaseResponse, res);
    } else {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', path);
      return preserveCookies(supabaseResponse, NextResponse.redirect(loginUrl));
    }
  }

  // 4. Handle Account Type Access Control
  if (matchedRule.allowedAccountTypes && matchedRule.allowedAccountTypes.length > 0) {
    if (!roleGuard(accountType, matchedRule.allowedAccountTypes)) {
      if (matchedRule.isApi) {
        const res = NextResponse.json(
          { success: false, error: APP_ERRORS.FORBIDDEN.code },
          { status: 403 },
        );
        return preserveCookies(supabaseResponse, res);
      } else {
        const fallbackUrl = new URL(ACCOUNT_TYPE_REDIRECTS[accountType] || '/login', request.url);
        return preserveCookies(supabaseResponse, NextResponse.redirect(fallbackUrl));
      }
    }
  }

  // 5. If all checks pass, proceed
  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
