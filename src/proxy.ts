import { type NextRequest, NextResponse } from 'next/server';
import { APP_ERRORS } from '@/lib/errors';
import { updateSession } from '@/lib/supabase/session';
import { routeRules } from '@/server/config/routes.config';
import { authGuard, roleGuard } from '@/server/guards';
import { UserRole } from '@/types';

function preserveCookies(originalResponse: NextResponse, newResponse: NextResponse) {
  originalResponse.cookies.getAll().forEach((cookie) => {
    newResponse.cookies.set(cookie.name, cookie.value);
  });
  return newResponse;
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

  // 2. Handle "Redirect if Authenticated" (e.g., /login -> /dashboard)
  if (user) {
    // Role-based redirect takes priority over the generic one
    if (matchedRule.redirectIfAuthenticatedByRole) {
      const userRole = user.app_metadata.role as UserRole;
      const destination = matchedRule.redirectIfAuthenticatedByRole[userRole];

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

  // 4. Handle RBAC (Role-Based Access Control) Requirement
  if (matchedRule.allowedRoles && matchedRule.allowedRoles.length > 0) {
    if (!roleGuard(user, matchedRule.allowedRoles)) {
      if (matchedRule.isApi) {
        const res = NextResponse.json(
          { success: false, error: APP_ERRORS.FORBIDDEN.code },
          { status: 403 },
        );
        return preserveCookies(supabaseResponse, res);
      } else {
        const roleRedirects: Record<string, string> = {
          [UserRole.SYS_ADMIN]: '/admin',
          [UserRole.TEACHER]: '/edu',
          [UserRole.UNIVERSITY_ADMIN]: '/manage',
          [UserRole.STUDENT]: '/app',
          [UserRole.FREE]: '/app',
          [UserRole.PREMIUM]: '/app',
        };
        const userRole = (user?.app_metadata?.role as string) || 'free';
        const fallbackUrl = new URL(roleRedirects[userRole] || '/login', request.url);
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
