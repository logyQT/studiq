import { createServiceClient } from '@admin/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Admin-compatible Supabase client factory.
 * Returns a service-role client (no user JWT required).
 * Matches the signature expected by admin services: () => Promise<SupabaseClient>.
 */
export function createClient(): Promise<SupabaseClient> {
  return Promise.resolve(createServiceClient());
}
