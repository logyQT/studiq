import { describe, it, expect } from 'vitest';
import { authGuard } from '@/server/guards/auth.guard';

describe('authGuard', () => {
  it('returns true when user is provided', () => {
    const user = { id: 'user-1', email: 'test@example.com' } as any;
    expect(authGuard(user)).toBe(true);
  });

  it('returns false when user is null', () => {
    expect(authGuard(null)).toBe(false);
  });
});
