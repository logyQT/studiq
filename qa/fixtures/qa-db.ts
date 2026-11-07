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

/**
 * "Now" on the database side of the wire, for timestamp cutoffs.
 *
 * `org_members.joined_at` and `invitations.created_at` are written by Postgres,
 * so comparing them with the test runner's `Date.now()` mixes two clocks (and a
 * skewed runner clock could delete a concurrent attempt's fresh row). The
 * Supabase REST gateway answers with a `Date` header produced on the same host
 * as the database in the native/CI stack (and NTP-synced on a hosted project),
 * so use that as the cutoff basis. A probe that cannot produce a usable header
 * fails the attempt: falling back to the runner clock would silently reintroduce
 * the cross-clock deletion this cutoff exists to prevent.
 */
export async function qaDbNow(): Promise<Date> {
  const { url, serviceKey } = sharedStackSettings();
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: serviceKey },
      signal: AbortSignal.timeout(2_000),
    });
    const header = res.headers.get('date');
    if (header) {
      const parsed = new Date(header);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    throw new Error(`qaDbNow: ${url}/rest/v1/ answered ${res.status} without a usable Date header`);
  } catch (error) {
    throw new Error(`qaDbNow: cannot read the database clock: ${(error as Error).message}`);
  }
}

/**
 * Return a **first-run** tenant account to "belongs to no organization".
 *
 * `ONB-02`/`ONB-04` are one-shot by nature: the run itself creates the
 * organization. A CI retry (or a `--repeat-each` replay) reuses the seeded
 * account, so without this the attempt starts on an onboarded account and the
 * first-run gate is already gone. Deleting the account's organizations cascades
 * their memberships, groups and content, exactly like `scripts/qa-tenant.ts
 * --reset` does for a `bare` profile.
 *
 * Only used for a case's own seeded account, never another tenant's.
 *
 * `createdBefore` must come from `qaDbNow()` (the clock that writes
 * `joined_at`) and the instant the attempt started. It keeps a parallel
 * `--repeat-each` attempt's newly created organization from being deleted: only
 * memberships that already existed when this attempt began are removed. A
 * membership with an unknown join time is left alone (never guessed as old).
 */
export async function resetFirstRunTenant(userId: string, createdBefore?: Date): Promise<void> {
  const db = createQaSupabase();
  const { data: memberships, error } = await db
    .from('org_members')
    .select('organization_id, joined_at')
    .eq('user_id', userId);
  if (error) throw new Error(`resetFirstRunTenant: read memberships: ${error.message}`);

  const cutoff = createdBefore?.getTime();
  for (const membership of memberships ?? []) {
    if (cutoff !== undefined) {
      if (!membership.joined_at) continue;
      if (new Date(membership.joined_at).getTime() >= cutoff) continue;
    }
    const { error: deleteError } = await db
      .from('organizations')
      .delete()
      .eq('id', membership.organization_id);
    if (deleteError) {
      throw new Error(
        `resetFirstRunTenant: delete org ${membership.organization_id}: ${deleteError.message}`,
      );
    }
  }
}
