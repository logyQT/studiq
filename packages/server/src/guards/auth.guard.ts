import type { User } from '@studiq/server/models/auth.model';

export function authGuard(user: User | null) {
  return !!user;
}
