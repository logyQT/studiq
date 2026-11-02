import { authGuard } from '@studiq/server/guards/auth.guard';
import type { User } from '@studiq/server/models/auth.model';
import { describe, expect, it } from 'vitest';

describe('authGuard', () => {
  it('returns true when user is provided', () => {
    const user: Partial<User> = { id: 'user-1', email: 'test@example.com' };
    expect(authGuard(user as User)).toBe(true);
  });

  it('returns false when user is null', () => {
    expect(authGuard(null)).toBe(false);
  });
});
