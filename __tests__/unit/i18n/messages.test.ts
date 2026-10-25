import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import { describe, expect, it } from 'vitest';

const locales = { en, pl } as const;

/**
 * The account page maps the API's `VALIDATION_PASSWORD_*` codes to `Errors.*`
 * messages and skips codes without a translation, so these keys must exist in
 * every locale or the user would silently lose the rule violation.
 */
const PASSWORD_RULE_CODES = [
  'VALIDATION_PASSWORD_TOO_SHORT',
  'VALIDATION_PASSWORD_MISSING_UPPERCASE',
  'VALIDATION_PASSWORD_MISSING_NUMBER',
] as const;

/**
 * #375 — the AI page's plan gate and its inline send-error alert read these
 * `AiChatPage` keys directly, so a missing translation would show the raw key
 * on a locked or blocked page.
 */
const AI_CHAT_PLAN_GATE_KEYS = [
  'locked_title',
  'locked_desc',
  'locked_cta',
  'error_title',
  'error_usage_limit',
  'error_generic',
  'error_retry',
  'error_dismiss',
  'usage_unlimited',
] as const;

describe.each(Object.entries(locales))('i18n messages (%s)', (_locale, messages) => {
  it('translates every password rule the account page surfaces', () => {
    for (const code of PASSWORD_RULE_CODES) {
      const message = messages.Errors[code as keyof typeof messages.Errors];

      expect(message, `Errors.${code}`).toBeTypeOf('string');
      expect(message).not.toHaveLength(0);
    }
  });

  it('translates every AI chat plan-gate and send-error key', () => {
    const aiChatPage = messages.AiChatPage as Record<string, string>;

    for (const key of AI_CHAT_PLAN_GATE_KEYS) {
      const message = aiChatPage[key];

      expect(message, `AiChatPage.${key}`).toBeTypeOf('string');
      expect(message).not.toHaveLength(0);
    }
  });

  it('translates the usage-limit and rate-limit error codes the AI alert shows', () => {
    for (const code of ['ERROR_USAGE_LIMIT_EXCEEDED', 'ERROR_RATE_LIMITED'] as const) {
      const message = messages.Errors[code];

      expect(message, `Errors.${code}`).toBeTypeOf('string');
      expect(message).not.toHaveLength(0);
    }
  });

  it('shows the password requirements hint', () => {
    expect(messages.AccountPage.password_requirements).toBeTypeOf('string');
    expect(messages.AccountPage.password_requirements).not.toHaveLength(0);
  });

  it('uses distinct copy for the success and failure paths', () => {
    expect(messages.AccountPage.password_updated).not.toBe(
      messages.AccountPage.password_update_failed,
    );
  });
});

describe('i18n message parity', () => {
  it('has the same AccountPage keys in en and pl', () => {
    expect(Object.keys(en.AccountPage).sort()).toEqual(Object.keys(pl.AccountPage).sort());
  });

  it('has the same AiChatPage keys in en and pl', () => {
    expect(Object.keys(en.AiChatPage).sort()).toEqual(Object.keys(pl.AiChatPage).sort());
  });
});
