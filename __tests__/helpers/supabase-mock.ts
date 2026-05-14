import { vi } from 'vitest';
import * as supabaseModule from '@/lib/supabase/server';

/**
 * Creates a mock Supabase client and wires it to createClient.
 * Returns the mock so tests can configure .from(), .rpc(), .auth per test.
 *
 * Usage in service tests:
 *   let mock: ReturnType<typeof mockSupabaseClient>;
 *   beforeEach(() => {
 *     vi.clearAllMocks();
 *     mock = mockSupabaseClient();
 *   });
 *   it('...', () => {
 *     mock.from.mockReturnValue({ select: vi.fn().mockReturnValue({ ... }) });
 *   });
 */
export function mockSupabaseClient() {
  const mock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      verifyOtp: vi.fn(),
    },
  };

  vi.mocked(supabaseModule.createClient).mockResolvedValue(mock as any);
  return mock;
}
