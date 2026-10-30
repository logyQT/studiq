import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client for the Supabase the QA suite runs against.
 *
 * A spec should build its data through the product's own API. The one exception
 * this suite needs is time: invitations are minted with a fixed 7-day expiry and
 * there is no "expire now" action, so a spec that covers the expired branch has
 * to age the single row it just created (keyed by its own token). This client is
 * only for that — never for reading another tenant's rows.
 *
 * Every QA worker keeps its own `apps/web/.env` (usually pointing at that
 * worker's own, now-idle stack), while `qa/env.json` names the shared stack the
 * browser tile and the app actually use, so `qa/env.json` wins for the URL. The
 * service-role key is the same local demo key everywhere; it is read from the
 * environment first and from `apps/web/.env` otherwise.
 */

interface QaEnvFile {
  supabaseUrl?: string;
}

function parseDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return values;
}

function sharedStackSettings(): { url: string; serviceKey: string } {
  const root = process.cwd();
  const dotenv = parseDotEnv(join(root, 'apps/web/.env'));

  let sharedUrl: string | undefined;
  const envFile = join(root, 'qa/env.json');
  if (existsSync(envFile)) {
    try {
      sharedUrl = (JSON.parse(readFileSync(envFile, 'utf8')) as QaEnvFile).supabaseUrl;
    } catch {
      // A malformed qa/env.json must not hide the real connection error.
    }
  }

  const url =
    process.env.SUPABASE_URL ??
    sharedUrl ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    dotenv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? dotenv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url)
    throw new Error('qa-db: no Supabase URL (qa/env.json supabaseUrl or NEXT_PUBLIC_SUPABASE_URL)');
  if (!serviceKey) throw new Error('qa-db: no SUPABASE_SERVICE_ROLE_KEY');
  return { url, serviceKey };
}

export function createQaSupabase(): SupabaseClient {
  const { url, serviceKey } = sharedStackSettings();
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
