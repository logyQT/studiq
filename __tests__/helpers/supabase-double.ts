/** Typing helpers for the Supabase client doubles service tests build. */
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Presents a partial client double as the typed `SupabaseClient<Database>`.
 *
 * Service tests stub only the entrypoints the service drives (`from`, `rpc`, …);
 * implementing the whole generated client surface is not realistic. The returned
 * intersection keeps the double's own `Mock` members callable, so a test can
 * assert the queries the service actually issued.
 */
export function asSupabaseClient<C extends object>(client: C): SupabaseClient<Database> & C {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- partial SupabaseClient<Database> test double; stubbing the full surface is impossible
  return client as SupabaseClient<Database> & C;
}
