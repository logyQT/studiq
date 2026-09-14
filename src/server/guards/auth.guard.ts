import type { User } from '@/server/models';

export function authGuard(user: User | null) {
  return !!user;
}
