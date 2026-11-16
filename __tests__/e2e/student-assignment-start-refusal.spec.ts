import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import { expect, test } from '#test/e2e/fixtures/tenant';
import { START_REFUSAL_CODES } from '#test/helpers/start-refusals';
import { APP_ERRORS } from '@studiq/server/lib/errors';

/**
 * #1273 — a refused start was silent: `handleStart` awaited `mutateAsync` with no error path, so
 * a `409 NO_UNSEEN_ITEMS` left the page unchanged and the console with an unhandled rejection.
 *
 * The refusal is stubbed at the network edge on purpose: the page's job is the message, and the
 * server side (an exhausted pool answers `NO_UNSEEN_ITEMS` instead of reusing items) is pinned by
 * `__tests__/integration/assessment-retake.test.ts`.
 */
const START_PATH = /\/api\/v1\/assignments\/[0-9a-f-]{36}\/start$/;

/** `Errors` with `Common` merged under it, the way `mergeCommon` hands it to `translateErrorCode`. */
const ERROR_COPY: Record<'en' | 'pl', Record<string, string>> = {
  en: { ...en.Common, ...en.Errors },
  pl: { ...pl.Common, ...pl.Errors },
};

for (const locale of ['en', 'pl'] as const) {
  test(`a refused start says why, in ${locale} (#1273)`, async ({ page, tenant, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs('student');
    // The fixture pins `en`; switch the way the language switcher does, before the page loads.
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: locale, url: new URL(page.url()).origin }]);

    for (const code of START_REFUSAL_CODES) {
      await page.route(START_PATH, (route) =>
        route.fulfill({
          status: APP_ERRORS[code].status,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            statusCode: APP_ERRORS[code].status,
            error: code,
          }),
        }),
      );

      await page.goto(`/app/assignments/${tenant.ids.assignment}`);
      const start = page.getByRole('button', { name: /^(Start Assignment|Rozpocznij kartkówkę)$/ });
      await start.click();

      await expect(
        page
          .locator('[data-sonner-toast]')
          .filter({ hasText: ERROR_COPY[locale][`ERROR_${code}`] }),
        code,
      ).toBeVisible();
      // The refusal is not a dead end: the button returns to its enabled state.
      await expect(start, code).toBeEnabled();
      await expect(page, code).toHaveURL(new RegExp(`/app/assignments/${tenant.ids.assignment}$`));

      await page.unroute(START_PATH);
    }
  });
}
