import { test } from '@playwright/test';

/**
 * TEMPORARY stack-mode exclusion for one test.
 *
 * Stack projects (Docker or native) cannot serve auth `content_path` templates,
 * so confirmation/recovery/invite e-mails use Supabase's default link instead
 * of the branded `/auth/callback?token_hash=…` URL these cases assert.
 *
 * Call this **inside** the test that inspects the branded link, never at file
 * scope: regression tests that do not read the mail (confirmed-account login,
 * unknown-address reset) must keep running in stack mode.
 *
 * `STUDIQ_STACK_MODE=1` is set by the native CI job (and can be set for a local
 * stack run) until stack mode supports templates. Remove the call sites and
 * this helper once branded templates work in stack mode.
 */
export function skipBrandedAuthTemplateTest(): void {
  test.skip(
    process.env.STUDIQ_STACK_MODE === '1',
    'stack mode cannot serve branded auth e-mail templates (content_path unsupported)',
  );
}
