import type { User } from '@/server/models/auth.model';

export function authGuard(user: User | null) {
  return !!user;
}
