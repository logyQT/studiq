import { createServiceClient } from '@admin/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@studiq/server/types/database';

/**
 * Admin-compatible Supabase client factory.
 * Returns a service-role client (no user JWT required).
 * Matches the signature expected by admin services: () => Promise<SupabaseClient<Database>>.
 */
export function createClient(): Promise<SupabaseClient<Database>> {
  return Promise.resolve(createServiceClient());
}
