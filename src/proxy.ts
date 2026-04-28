import { type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';
import { authGuard } from './server/guards/auth.guard';
import { roleGuard } from './server/guards/role.guard';
import { NextResponse } from 'next/server';

export async function proxy(request: NextRequest) {
  const { user, response } = await updateSession(request);

  const path = request.nextUrl.pathname;

  // --- 1. OCHRONA TRAS API (v1) ---

  // Ochrona endpointów administratora
  if (path.startsWith('/api/v1/admin')) {
    const auth = authGuard(user);
    if (!auth.isAuthorized) return auth.response;

    const role = roleGuard(user, ['admin']);
    if (!role.hasRole) return role.response;
  }

  // Ochrona endpointów wykładowcy
  if (path.startsWith('/api/v1/teacher')) {
    const auth = authGuard(user);
    if (!auth.isAuthorized) return auth.response;

    const role = roleGuard(user, ['teacher', 'admin']);
    if (!role.hasRole) return role.response;
  }

  // --- 2. PRZEKIEROWANIA INTERFEJSU (UI) ---

  // Jeśli niezalogowany próbuje wejść na dashboard -> wyrzuć go do logowania
  if (path.startsWith('/dashboard') && !user) {
    const loginUrl = new URL('/login', request.url);
    // Zachowujemy informację, gdzie użytkownik chciał wejść (next parameter)
    loginUrl.searchParams.set('next', path);
    return NextResponse.redirect(loginUrl);
  }

  // Jeśli zalogowany próbuje wejść na /login lub /register -> przenieś go na główny dashboard
  if ((path === '/login' || path === '/register') && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // --- 3. RBAC DLA WIDOKÓW DASHBOARDU (UI) ---

  // Ochrona stron administratora w przeglądarce
  if (path.startsWith('/dashboard/admin')) {
    const role = roleGuard(user, ['admin']);
    if (!role.hasRole) {
      // Jeśli brak roli, wróć na ogólny dashboard
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Ochrona stron wykładowcy w przeglądarce
  if (path.startsWith('/dashboard/teacher')) {
    const role = roleGuard(user, ['teacher', 'admin']);
    if (!role.hasRole) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return response;
}
