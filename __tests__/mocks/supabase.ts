import { vi } from 'vitest';

export function createMockSupabase() {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn((columns?: string) => ({
        eq: vi.fn((_col: string, _val: unknown) => ({
          single: vi.fn(() => ({ data: null, error: null })),
          order: vi.fn((_col: string, _opts: unknown) => ({ data: [], error: null })),
        })),
        in: vi.fn((_col: string, _vals: unknown[]) => ({
          order: vi.fn((_col: string, _opts: unknown) => ({ data: [], error: null })),
        })),
        single: vi.fn(() => ({ data: null, error: null })),
        order: vi.fn((_col: string, _opts: unknown) => ({ data: [], error: null })),
        limit: vi.fn((_n: number) => ({ data: [], error: null })),
      })),
      insert: vi.fn((_data: unknown) => ({
        select: vi.fn((columns?: string) => ({
          single: vi.fn(() => ({ data: null, error: null })),
        })),
      })),
      update: vi.fn((_data: unknown) => ({
        eq: vi.fn((_col: string, _val: unknown) => ({
          select: vi.fn((columns?: string) => ({
            single: vi.fn(() => ({ data: null, error: null })),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn((_col: string, _val: unknown) => ({ error: null })),
        neq: vi.fn((_col: string, _val: unknown) => ({ error: null })),
      })),
      rpc: vi.fn((_fn: string, _params: unknown) => ({ error: null })),
    })),
    auth: {
      getUser: vi.fn(() => ({ data: { user: { id: 'test-user-id' } }, error: null })),
      signUp: vi.fn(() => ({ data: { user: null }, error: null })),
      signInWithPassword: vi.fn(() => ({ data: { user: null, session: null }, error: null })),
      signOut: vi.fn(() => ({ error: null })),
      resetPasswordForEmail: vi.fn(() => ({ error: null })),
      updateUser: vi.fn(() => ({ data: { user: null }, error: null })),
      exchangeCodeForSession: vi.fn(() => ({ error: null })),
      verifyOtp: vi.fn(() => ({ error: null })),
    },
  };
}

export type MockSupabase = ReturnType<typeof createMockSupabase>;
