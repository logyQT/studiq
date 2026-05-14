import { vi } from 'vitest';

/**
 * Register the Supabase module as mockable so vi.mocked() works in service tests.
 * The default implementation wraps the real createClient — integration tests
 * hit the real database, unit tests override via mockSupabaseClient().
 */
vi.mock('@/lib/supabase/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/server')>();
  return {
    createClient: vi.fn(actual.createClient),
  };
});
