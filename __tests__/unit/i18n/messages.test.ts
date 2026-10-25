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

describe.each(Object.entries(locales))('i18n messages (%s)', (_locale, messages) => {
  it('translates every password rule the account page surfaces', () => {
    for (const code of PASSWORD_RULE_CODES) {
      const message = messages.Errors[code as keyof typeof messages.Errors];

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
});
