import { type NextRequest, NextResponse } from 'next/server';
import { APP_ERRORS } from '@/lib/errors';
import { updateSession } from '@/lib/supabase/session';
import { routeRules } from '@/server/config/routes.config';
import { authGuard, roleGuard } from '@/server/guards';
import { AccountType } from '@/types';

const ACCOUNT_TYPE_REDIRECTS: Record<string, string> = {
  [AccountType.SYS_ADMIN]: '/admin',
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
    if (matchedRule.redirectIfAuthenticatedByAccountType) {
      const destination = matchedRule.redirectIfAuthenticatedByAccountType[accountType];

      if (destination) {
        const url = new URL(destination, request.url);
        return preserveCookies(supabaseResponse, NextResponse.redirect(url));
      }
    }

    if (matchedRule.redirectIfAuthenticated) {
      const url = new URL(matchedRule.redirectIfAuthenticated, request.url);
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
