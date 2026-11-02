import * as supabaseModule from '@studiq/server/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type Mock, vi } from 'vitest';

/**
 * The Supabase entrypoints a service test stubs: `from`, `rpc` and the auth methods
 * it drives. Intersecting with the real `SupabaseClient` keeps the mock usable
 * wherever a real client is expected (e.g. `new Service(async () => mock)`),
 * while `.mockResolvedValue()` etc. stay typed.
 */
export type MockSupabaseClient = SupabaseClient & {
  from: Mock;
  rpc: Mock;
  auth: {
    getUser: Mock;
    signUp: Mock;
    signInWithPassword: Mock;
    signOut: Mock;
    resetPasswordForEmail: Mock;
    updateUser: Mock;
    getClaims: Mock;
    exchangeCodeForSession: Mock;
    verifyOtp: Mock;
  };
};

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
export function mockSupabaseClient(): MockSupabaseClient {
  // The mock only implements the entrypoints the tests use; the rest of the real
  // client surface is never touched, so a single assertion at the boundary is enough.
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
      getClaims: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      verifyOtp: vi.fn(),
    },
  } as unknown as MockSupabaseClient;

  vi.mocked(supabaseModule.createClient).mockResolvedValue(mock);
  return mock;
}
