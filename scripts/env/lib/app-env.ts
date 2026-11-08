import { EXIT_START_FAILED, EnvFailure } from './exit';
import type { StackEnv } from './stack';
import { normalizeLocalhost, trimTrailingSlash } from './urls';

/**
 * Local posture and shared-stack environment shared by `ensure` and `build`.
 * Keeping one implementation prevents the two commands computing different
 * `APP_ENV`/`envHash` values for the same shared stack.
 */
export function resolveLocalAppEnv(): string {
  const raw = (process.env.APP_ENV ?? '').trim().toLowerCase();
  const value = raw || 'development';
  if (value === 'production') {
    throw new EnvFailure(
      EXIT_START_FAILED,
      'APP_ENV=production cannot build/serve this local checkout (it requires a live Stripe key and an https site URL); set APP_ENV=development, test or qa',
    );
  }
  if (value !== 'development' && value !== 'test' && value !== 'qa') {
    throw new EnvFailure(
      EXIT_START_FAILED,
      `APP_ENV='${value}' is not valid for a local checkout (use development, test or qa)`,
    );
  }
  return value;
}

/** Values for a shared stack, resolved from the already-injected environment. */
export function sharedStackEnv(): StackEnv {
  const apiUrl = normalizeLocalhost(trimTrailingSlash(process.env.SUPABASE_URL ?? ''));
  return {
    apiUrl,
    restUrl: apiUrl ? `${apiUrl}/rest/v1` : null,
    dbUrl: process.env.SUPABASE_DB_URL ?? null,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    publishableKey: null,
    secretKey: null,
    mailUrl: process.env.SUPABASE_MAIL_URL ?? null,
    studioUrl: process.env.SUPABASE_STUDIO_URL ?? null,
  };
}
