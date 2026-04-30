import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from './lib/supabase/session';
import { authGuard } from './server/guards/auth.guard';
import { roleGuard } from './server/guards/role.guard';
import { routeRules } from './server/config/routes.config';
import { AppErrorCode } from '@/lib/errors';

function preserveCookies(originalResponse: NextResponse, newResponse: NextResponse) {
  originalResponse.cookies.getAll().forEach((cookie) => {
    newResponse.cookies.set(cookie.name, cookie.value);
  });
  return newResponse;
}

export async function proxy(request: NextRequest) {
  const { user, response: supabaseResponse } = await updateSession(request);
  const path = request.nextUrl.pathname;

  const matchedRule = routeRules.find((rule) => rule.matcher.test(path));

  // If no rule matches, let the request pass through (public route)
  if (!matchedRule) {
    return supabaseResponse;
  }

  // 2. Handle "Redirect if Authenticated" (e.g., /login -> /dashboard)
  if (matchedRule.redirectIfAuthenticated && user) {
    const url = new URL(matchedRule.redirectIfAuthenticated, request.url);
    return preserveCookies(supabaseResponse, NextResponse.redirect(url));
  }

  // 3. Handle Authentication Requirement
  if (matchedRule.requireAuth && !authGuard(user)) {
    if (matchedRule.isApi) {
      const res = NextResponse.json(
        { success: false, error: AppErrorCode.UNAUTHORIZED },
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
          { success: false, error: AppErrorCode.FORBIDDEN },
          { status: 403 },
        );
        return preserveCookies(supabaseResponse, res);
      } else {
        // Redirect unauthorized UI access back to the base dashboard
        const dashboardUrl = new URL('/dashboard', request.url);
        return preserveCookies(supabaseResponse, NextResponse.redirect(dashboardUrl));
      }
    }
  }

  // 5. If all checks pass, proceed
  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
