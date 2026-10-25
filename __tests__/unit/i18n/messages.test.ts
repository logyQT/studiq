import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import adminEn from '@admin/i18n/messages/en.json';
import adminPl from '@admin/i18n/messages/pl.json';
import { describe, expect, it } from 'vitest';

const locales = { en, pl } as const;

/**
 * #294 — a Russian verb shipped inside the Polish terms copy. Message values are
 * rendered verbatim, so a wrong-script word in legal copy is invisible to every
 * other check; guard the whole class here. Scoped to Cyrillic on purpose: the
 * files legitimately contain `—`, `©` and `⚠️`.
 */
const CYRILLIC = /\p{Script=Cyrillic}/u;

const MESSAGE_FILES = {
  'web:en': en,
  'web:pl': pl,
  'admin:en': adminEn,
  'admin:pl': adminPl,
} as const;

function flattenMessages(value: unknown, prefix = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[prefix, value]];

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flattenMessages(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  return [];
}

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
] as const;

/**
 * #139 — `DeckFormDialog` renders the group-required hint from these namespaces,
 * so a missing translation would show the raw key instead of the rule.
 */
const DECK_GROUP_REQUIRED_NAMESPACES = [
  'EduFlashcardDecksPage',
  'AppFlashcardDecksPage',
  'EduDeckViewPage',
  'AppFlashcardDeckViewPage',
] as const;

/**
 * #360 (STU-31) — the bank grid picks its copy from these keys, so a missing
 * translation would show a raw key instead of the empty / no-results state.
 */
const QUESTION_BANK_EMPTY_STATE_KEYS = [
  'no_banks',
  'no_banks_match',
  'no_banks_match_filters',
  'clear_filters',
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

  it('translates the deck group-required hint in every deck namespace', () => {
    for (const namespace of DECK_GROUP_REQUIRED_NAMESPACES) {
      const message = (messages[namespace] as Record<string, string>).groups_required;

      expect(message, `${namespace}.groups_required`).toBeTypeOf('string');
      expect(message).not.toHaveLength(0);
    }
  });

  it('translates every question-bank empty / no-results key', () => {
    const namespace = messages.QuestionBankManagement as Record<string, string>;

    for (const key of QUESTION_BANK_EMPTY_STATE_KEYS) {
      const message = namespace[key];

      expect(message, `QuestionBankManagement.${key}`).toBeTypeOf('string');
      expect(message).not.toHaveLength(0);
    }
  });

  /**
   * #335 — the /app sidebar entry and the page it opens are labelled by two
   * different keys, so they silently drifted („Talie” vs „Talie fiszek”). Pin
   * them together; the /edu sidebar keeps `flashcard_decks` on purpose.
   */
  it('labels the student deck list and its page title consistently', () => {
    const sidebarLabel = messages.DashboardLayout.app_flashcard_decks;

    expect(sidebarLabel, 'DashboardLayout.app_flashcard_decks').toBeTypeOf('string');
    expect(sidebarLabel).not.toHaveLength(0);
    expect(sidebarLabel).toBe(messages.AppFlashcardDecksPage.title);
  });

  it('uses distinct copy for the success and failure paths', () => {
    expect(messages.AccountPage.password_updated).not.toBe(
      messages.AccountPage.password_update_failed,
    );
  });

  /**
   * #295 — the /terms cookie list prints each `cookies_item*` verbatim inside its own
   * <li>, so a separator must be a colon + space, never a bare `;` (PUB-06).
   */
  it('separates the cookie category from its description', () => {
    const termsPage = messages.TermsPage as Record<string, string>;

    for (const key of ['cookies_item1', 'cookies_item2', 'cookies_item3'] as const) {
      const message = termsPage[key];

      expect(message, `TermsPage.${key}`).toBeTypeOf('string');
      expect(message, `TermsPage.${key}`).toMatch(/^[^;]+: \S/);
    }

    for (const [key, message] of Object.entries(termsPage)) {
      expect(message, `TermsPage.${key}`).not.toMatch(/;\S/);
    }
  });
});

describe('i18n message parity', () => {
  /**
   * #335 — the deck wording is split on purpose: the student area says „Fiszki”
   * and the educator area keeps „Talie”. Editing the shared `flashcard_decks`
   * value would rename the /edu sidebar again, so pin both sides here.
   */
  it('keeps the student and educator deck labels separate', () => {
    expect(pl.DashboardLayout.app_flashcard_decks).toBe('Fiszki');
    expect(en.DashboardLayout.app_flashcard_decks).toBe('Flashcards');
    expect(pl.DashboardLayout.flashcard_decks).toBe('Talie');
    expect(en.DashboardLayout.flashcard_decks).toBe('Decks');
  });

  it('has the same AccountPage keys in en and pl', () => {
    expect(Object.keys(en.AccountPage).sort()).toEqual(Object.keys(pl.AccountPage).sort());
  });

  /**
   * #360 — the bank grid renders the same namespace on `/app/questions` and
   * `/edu/questions`; a key present in only one locale would show a raw key.
   */
  it('has the same QuestionBankManagement keys in en and pl', () => {
    expect(Object.keys(en.QuestionBankManagement).sort()).toEqual(
      Object.keys(pl.QuestionBankManagement).sort(),
    );
  });

  it('has the same AiChatPage keys in en and pl', () => {
    expect(Object.keys(en.AiChatPage).sort()).toEqual(Object.keys(pl.AiChatPage).sort());
  });

  /**
   * #341 — the stats “Interwał” cell formats the interval magnitude with its unit,
   * so a missing key would throw at render time and 1 min / 1 day would be unreadable.
   */
  it('has the same AppStatsPage keys in en and pl', () => {
    expect(Object.keys(en.AppStatsPage).sort()).toEqual(Object.keys(pl.AppStatsPage).sort());
  });

  it('translates the stats interval unit labels', () => {
    for (const locale of Object.values(locales)) {
      const statsPage = locale.AppStatsPage as Record<string, string>;

      for (const key of ['interval_minutes', 'interval_days'] as const) {
        expect(statsPage[key], `AppStatsPage.${key}`).toBeTypeOf('string');
        expect(statsPage[key]).not.toHaveLength(0);
      }
    }
  });
});

describe('i18n message script hygiene', () => {
  it.each(Object.entries(MESSAGE_FILES))(
    '%s contains no Cyrillic characters',
    (_name, messages) => {
      const offenders = flattenMessages(messages)
        .filter(([, text]) => CYRILLIC.test(text))
        .map(([key]) => key);

      expect(offenders).toEqual([]);
    },
  );
});
