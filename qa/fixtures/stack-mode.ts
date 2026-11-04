import { test } from '@playwright/test';

/**
 * TEMPORARY stack-mode exclusion.
 *
 * Stack projects (Docker or native) cannot serve auth `content_path` templates,
 * so confirmation/recovery/invite e-mails use Supabase's default link instead
 * of the branded `/auth/callback?token_hash=…` URL these cases assert.
 *
 * `STUDIQ_STACK_MODE=1` is set by the native CI job (and can be set for a local
 * stack run) until stack mode supports templates. Remove the call sites and
 * this helper once the branded templates work in stack mode.
 */
export function skipBrandedAuthTemplateTests(): void {
  test.skip(
    process.env.STUDIQ_STACK_MODE === '1',
    'stack mode cannot serve branded auth e-mail templates (content_path unsupported)',
  );
}
