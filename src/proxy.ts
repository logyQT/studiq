import { type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';
import { authGuard } from './server/guards/auth.guard';
import { roleGuard } from './server/guards/role.guard';

export async function proxy(request: NextRequest) {
  const { user, response } = await updateSession(request);

  const path = request.nextUrl.pathname;

  if (path.startsWith('/api/v1/admin')) {
    const auth = authGuard(user);
    if (!auth.isAuthorized) return auth.response;

    const role = roleGuard(user, ['admin']);
    if (!role.hasRole) return role.response;
  }

  if (path.startsWith('/api/v1/teacher')) {
    const auth = authGuard(user);
    if (!auth.isAuthorized) return auth.response;

    const role = roleGuard(user, ['teacher', 'admin']);
    if (!role.hasRole) return role.response;
  }

  return response;
}
