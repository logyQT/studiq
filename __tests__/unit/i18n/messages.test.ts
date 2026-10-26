import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import adminEn from '@admin/i18n/messages/en.json';
import adminPl from '@admin/i18n/messages/pl.json';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

const locales = { en, pl } as const;

/**
 * #364 — `DeckDetailScreen` is rendered under two namespaces (`/app` and
 * `/edu`), so both carry the same bulk-action copy and both must pluralise.
 */
const DECK_VIEW_NAMESPACES = ['AppFlashcardDeckViewPage', 'EduDeckViewPage'] as const;

function deckViewTranslator(locale: 'en' | 'pl', namespace: (typeof DECK_VIEW_NAMESPACES)[number]) {
  return createTranslator({ locale, messages: locales[locale], namespace });
}

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
 * #259 — the roles page plan gate renders these `ManageRolesPage` keys directly,
 * so a missing translation would show the raw key on a locked page.
 */
const MANAGE_ROLES_PLAN_GATE_KEYS = ['locked_title', 'locked_desc', 'locked_cta'] as const;

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

/**
 * #284 — the public /status page renders every `StatusPage` key directly, so a
 * missing translation would show a raw key on the page visitors reach from the
 * 404 screen. The exact set is asserted (not only en/pl parity) so removing a key
 * from both files fails.
 */
const STATUS_PAGE_KEYS = [
  'meta_title',
  'title',
  'loading',
  'operational',
  'problem',
  'unavailable',
  'last_checked',
] as const;

/**
 * #329 — the practice quiz review page used to render hard-coded English. Every
 * string now comes from this namespace, so a missing key would show the raw key
 * to a student mid-review; the exact set is asserted so a dropped key fails.
 */
const APP_QUIZ_REVIEW_KEYS = [
  'title',
  'back',
  'loading',
  'load_failed',
  'score_percent',
  'points_out_of',
  'correct_of',
  'correct_closed',
  'open_questions_line',
  'open_only_title',
  'open_only_desc',
  'badge_correct',
  'badge_incorrect',
  'badge_pending_review',
  'badge_self_check',
  'question_short',
  'type_mcq',
  'type_true_false',
  'type_open',
  'your_answer',
  'no_answer',
  'explanation',
] as const;

/**
 * #367 — the student assignment list used to render its scheduled/closed
 * sections as raw English literals, so the Polish page mixed „OCZEKUJĄCE (1)”
 * with `SCHEDULED (1)` / `Opens:` / `Closed:`. Every key now goes through
 * `next-intl`; the placeholder assertions catch a translation that drops
 * `{count}` / `{date}` and would render an empty date next to the label.
 */
const ASSIGNMENTS_LIST_PLACEHOLDERS = {
  scheduled: '{count}',
  scheduled_badge: null,
  opens: '{date}',
  closed: '{count}',
  closed_on: '{date}',
} as const;

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

  it('translates every manage-roles plan-gate key', () => {
    const manageRolesPage = messages.ManageRolesPage as Record<string, string>;

    for (const key of MANAGE_ROLES_PLAN_GATE_KEYS) {
      const message = manageRolesPage[key];

      expect(message, `ManageRolesPage.${key}`).toBeTypeOf('string');
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

  /**
   * #367 — every scheduled/closed label on /app/assignments is translated, and
   * the interpolated ones keep their placeholder so the date/count still render.
   */
  it('translates the assignment list scheduled and closed labels', () => {
    const assignmentsPage = messages.AppAssignmentsPage as Record<string, string>;

    for (const [key, placeholder] of Object.entries(ASSIGNMENTS_LIST_PLACEHOLDERS)) {
      const message = assignmentsPage[key];

      expect(message, `AppAssignmentsPage.${key}`).toBeTypeOf('string');
      expect(message).not.toHaveLength(0);

      if (placeholder) {
        expect(message, `AppAssignmentsPage.${key}`).toContain(placeholder);
      }
    }
  });

  it('shows the password requirements hint', () => {
    expect(messages.AccountPage.password_requirements).toBeTypeOf('string');
    expect(messages.AccountPage.password_requirements).not.toHaveLength(0);
  });

  it('shows the member count in the manage-members header', () => {
    const message = (messages.ManageMembersPage as Record<string, string>).total_count;

    expect(message).toContain('{count}');
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
   * #319 — the endless session summary explains why „Przeglądaj ponownie” is
   * absent instead of silently omitting it; a missing key would render the raw
   * key inside the dialog.
   */
  it('translates the exhausted-session summary state', () => {
    const sessionPage = messages.AppFlashcardSessionPage as Record<string, string>;

    for (const key of ['all_caught_up', 'all_caught_up_desc'] as const) {
      const message = sessionPage[key];

      expect(message, `AppFlashcardSessionPage.${key}`).toBeTypeOf('string');
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

  it('translates exactly the quiz review page keys', () => {
    const quizReviewPage = messages.AppQuizReviewPage as Record<string, string>;

    expect(Object.keys(quizReviewPage).sort()).toEqual([...APP_QUIZ_REVIEW_KEYS].sort());

    for (const key of APP_QUIZ_REVIEW_KEYS) {
      const message = quizReviewPage[key];

      expect(message, `AppQuizReviewPage.${key}`).toBeTypeOf('string');
      expect(message, `AppQuizReviewPage.${key}`).not.toHaveLength(0);
    }
  });

  it('translates exactly the public status page keys', () => {
    const statusPage = messages.StatusPage as Record<string, string>;

    expect(Object.keys(statusPage).sort()).toEqual([...STATUS_PAGE_KEYS].sort());

    for (const key of STATUS_PAGE_KEYS) {
      const message = statusPage[key];

      expect(message, `StatusPage.${key}`).toBeTypeOf('string');
      expect(message, `StatusPage.${key}`).not.toHaveLength(0);
    }
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

describe('deck view bulk action copy (#364)', () => {
  it.each(DECK_VIEW_NAMESPACES)('%s pluralises the Polish bulk copy', (namespace) => {
    const t = deckViewTranslator('pl', namespace);

    expect(t('bulk_delete_title', { count: 1 })).toBe('Usunąć 1 fiszkę?');
    expect(t('bulk_delete_title', { count: 3 })).toBe('Usunąć 3 fiszki?');
    expect(t('bulk_delete_title', { count: 5 })).toBe('Usunąć 5 fiszek?');
    expect(t('bulk_delete_desc', { count: 1 })).toMatch(/^Ta fiszka /);
    expect(t('bulk_delete_desc', { count: 2 })).toMatch(/^Te fiszki /);
    expect(t('bulk_copied', { count: 2 })).toBe('Skopiowano 2 fiszki');
    expect(t('bulk_copied', { count: 5 })).toBe('Skopiowano 5 fiszek');
    expect(t('bulk_deleted', { count: 2 })).toBe('Usunięto 2 fiszki');
    expect(t('bulk_moved', { count: 1 })).toBe('Fiszkę przeniesiono do nowej talii');
    expect(t('bulk_moved', { count: 2 })).toBe('Fiszki przeniesiono do nowej talii');
    expect(t('bulk_topics_updated', { count: 2 })).toBe('Zaktualizowano tematy dla 2 fiszek');
  });

  it.each(DECK_VIEW_NAMESPACES)('%s pluralises the English bulk copy', (namespace) => {
    const t = deckViewTranslator('en', namespace);

    expect(t('bulk_delete_title', { count: 1 })).toBe('Delete 1 flashcard?');
    expect(t('bulk_delete_title', { count: 2 })).toBe('Delete 2 flashcards?');
    expect(t('bulk_delete_desc', { count: 2 })).toBe(
      'This will permanently delete 2 flashcards. This action cannot be undone.',
    );
    expect(t('bulk_copied', { count: 2 })).toBe('2 flashcards copied');
    expect(t('bulk_deleted', { count: 2 })).toBe('2 flashcards deleted');
    expect(t('bulk_moved', { count: 2 })).toBe('Flashcards moved to new deck');
    expect(t('bulk_topics_updated', { count: 2 })).toBe('Topics updated for 2 flashcards');
  });

  /**
   * A new key added to only one locale would render the raw key or a
   * MISSING_MESSAGE, so pin the bulk keys in both locales.
   */
  it.each(DECK_VIEW_NAMESPACES)('%s has every bulk key in en and pl', (namespace) => {
    const BULK_KEYS = [
      'bulk_delete_title',
      'bulk_delete_desc',
      'bulk_copied',
      'bulk_deleted',
      'bulk_moved',
      'bulk_topics_updated',
    ] as const;

    for (const key of BULK_KEYS) {
      for (const [locale, messages] of Object.entries(locales)) {
        const message = messages[namespace][key];

        expect(message, `${locale}:${namespace}.${key}`).toBeTypeOf('string');
        expect(message, `${locale}:${namespace}.${key}`).not.toHaveLength(0);
      }
    }
  });
});

describe('quiz review copy (#329)', () => {
  const quizReview = (locale: 'en' | 'pl') =>
    createTranslator({ locale, messages: locales[locale], namespace: 'AppQuizReviewPage' });

  it('pluralises the open-question lines in Polish', () => {
    const t = quizReview('pl');

    expect(t('open_questions_line', { count: 1 })).toBe(
      'Pytanie otwarte: 1 — sprawdź samodzielnie',
    );
    expect(t('open_questions_line', { count: 2 })).toBe(
      'Pytania otwarte: 2 — sprawdź samodzielnie',
    );
    expect(t('open_questions_line', { count: 5 })).toBe(
      'Pytań otwartych: 5 — sprawdź samodzielnie',
    );
    expect(t('open_only_desc', { count: 1 })).toBe(
      'Masz 1 pytanie otwarte do samodzielnego sprawdzenia.',
    );
    expect(t('open_only_desc', { count: 2 })).toBe(
      'Masz 2 pytania otwarte do samodzielnego sprawdzenia.',
    );
    expect(t('open_only_desc', { count: 5 })).toBe(
      'Masz 5 pytań otwartych do samodzielnego sprawdzenia.',
    );
  });

  it('pluralises the open-question lines in English', () => {
    const t = quizReview('en');

    expect(t('open_questions_line', { count: 1 })).toBe('1 open question — check it yourself');
    expect(t('open_questions_line', { count: 2 })).toBe('2 open questions — check them yourself');
    expect(t('open_only_desc', { count: 1 })).toBe('You have 1 open answer to check yourself.');
    expect(t('open_only_desc', { count: 2 })).toBe('You have 2 open answers to check yourself.');
  });

  /**
   * The mixed practice state must never print a percentage, so it leads with the
   * closed-question fraction; the all-closed state keeps the legacy percentage.
   */
  it('renders the closed-question fraction in both locales', () => {
    expect(quizReview('pl')('correct_closed', { score: 2, total: 9 })).toBe(
      'Poprawnie: 2 z 9 pytań zamkniętych',
    );
    expect(quizReview('en')('correct_closed', { score: 2, total: 9 })).toBe(
      'Correct: 2 of 9 graded questions',
    );
    expect(quizReview('en')('correct_closed', { score: 1, total: 1 })).toBe(
      'Correct: 1 of 1 graded question',
    );
  });

  it('interpolates the score, points and question-number placeholders', () => {
    const t = quizReview('pl');

    expect(t('score_percent', { percentage: 66 })).toBe('Wynik: 66%');
    expect(t('points_out_of', { score: 2, total: 10 })).toBe('2 z 10 punktów');
    expect(t('correct_of', { score: 7, total: 9 })).toBe('7 z 9 poprawnych');
    expect(t('question_short', { number: 3 })).toBe('P3');
    expect(quizReview('en')('question_short', { number: 3 })).toBe('Q3');
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

  it('has the same AppAssignmentsPage keys in en and pl', () => {
    expect(Object.keys(en.AppAssignmentsPage).sort()).toEqual(
      Object.keys(pl.AppAssignmentsPage).sort(),
    );
  });

  /**
   * #319 — the session summary dialog resolves its keys dynamically (mode suffix,
   * exhausted state), so a key present in only one locale would silently show the
   * raw key to that locale's users.
   */
  it('has the same AppFlashcardSessionPage keys in en and pl', () => {
    expect(Object.keys(en.AppFlashcardSessionPage).sort()).toEqual(
      Object.keys(pl.AppFlashcardSessionPage).sort(),
    );
  });

  /**
   * #341 — the stats “Interwał” cell formats the interval magnitude with its unit,
   * so a missing key would throw at render time and 1 min / 1 day would be unreadable.
   */
  it('has the same AppStatsPage keys in en and pl', () => {
    expect(Object.keys(en.AppStatsPage).sort()).toEqual(Object.keys(pl.AppStatsPage).sort());
  });

  /**
   * #329 — the practice review page renders from `AppQuizReviewPage` in both
   * locales; a key present in only one would show the raw key mid-review.
   */
  it('has the same AppQuizReviewPage keys in en and pl', () => {
    expect(Object.keys(en.AppQuizReviewPage).sort()).toEqual(
      Object.keys(pl.AppQuizReviewPage).sort(),
    );
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
