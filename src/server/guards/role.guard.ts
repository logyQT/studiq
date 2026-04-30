import { User } from '@/server/models';

export function roleGuard(user: User | null, allowedRoles: string[]): boolean {
  if (!user) return false;

  const userRole = user.user_metadata?.role;

  if (!userRole) return false;
  return allowedRoles.includes(userRole);
}
