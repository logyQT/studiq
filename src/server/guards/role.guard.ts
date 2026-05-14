import { User } from '@/server/models';
import { UserRole } from '@/types';

export function roleGuard(user: User | null, allowedRoles: string[]): boolean {
  if (!user) return false;

  const userRole = user.app_metadata.role as UserRole;

  if (!userRole) return false;
  return allowedRoles.includes(userRole);
}
