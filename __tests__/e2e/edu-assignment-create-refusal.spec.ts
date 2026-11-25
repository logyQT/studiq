import { APP_ERRORS } from '@studiq/server/lib/errors';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import { expect, test } from '#test/e2e/fixtures/tenant';

/**
 * #1185 — `/edu/assignments/new` awaited `mutateAsync` with no error path, so a refused create
 * (here the `422` for a quiz copy that holds a retired or deleted item) left the page unchanged:
 * no toast, no inline error, and an unhandled rejection in the console.
 *
 * The refusal is stubbed at the network edge on purpose: the page's job is the message and keeping
 * the form, and the server side is pinned by the `item-states` integration test and the service
 * unit tests (a retired or deleted item answers `QUESTION_NOT_OPEN`).
 */
const CREATE_PATH = /\/api\/v1\/teacher\/assignments$/;

/** `Errors` with `Common` merged under it, the way `mergeCommon` hands it to `translateErrorCode`. */
const ERROR_COPY: Record<'en' | 'pl', Record<string, string>> = {
  en: { ...en.Common, ...en.Errors },
  pl: { ...pl.Common, ...pl.Errors },
};

const CODE = 'QUESTION_NOT_OPEN';
const CREATE_BUTTON = new RegExp(
  `^(${en.EduAssignmentForm.create}|${pl.EduAssignmentForm.create})$`,
);

for (const locale of ['en', 'pl'] as const) {
  test(`a refused create says why and keeps the form, in ${locale} (#1185)`, async ({
    page,
    loginAs,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs('teacher');
    // The fixture pins `en`; switch the way the language switcher does, before the page loads.
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: locale, url: new URL(page.url()).origin }]);

    await page.route(CREATE_PATH, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: APP_ERRORS[CODE].status,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, statusCode: APP_ERRORS[CODE].status, error: CODE }),
      });
    });

    await page.goto('/edu/assignments/new');
    const title = page.locator('#title');
    await title.fill(`Refused create ${locale} #1185`);
    const submit = page.getByRole('button', { name: CREATE_BUTTON });
    await submit.click();

    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: ERROR_COPY[locale][`ERROR_${CODE}`] }),
    ).toBeVisible();
    // The refusal is not a dead end: the page stays, the teacher's input survives, and the
    // button is usable again.
    await expect(page).toHaveURL(/\/edu\/assignments\/new$/);
    await expect(title).toHaveValue(`Refused create ${locale} #1185`);
    await expect(submit).toBeEnabled();
    expect(pageErrors, 'no unhandled rejection reaches the console').toEqual([]);
  });
}
