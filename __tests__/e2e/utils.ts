import type { Page } from '@playwright/test';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getNested = (obj: Record<string, unknown>, keyPath: string): unknown =>
  keyPath.split('.').reduce<unknown>((prev, curr) => {
    if (!isRecord(prev) || !(curr in prev)) return undefined;
    return prev[curr];
  }, obj);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const t = (path: string) => {
  const enVal = getNested(en, path);
  const plVal = getNested(pl, path);

  if (typeof enVal !== 'string' || typeof plVal !== 'string') {
    throw new Error(`Translation key "${path}" missing in en or pl json`);
  }

  return new RegExp(`${escapeRegExp(enVal)}|${escapeRegExp(plVal)}`, 'i');
};

/**
 * A sidebar nav link by its DashboardLayout label.
 *
 * `getByRole('link', { name })` is ambiguous on dashboard pages: quick-action
 * cards link to the same route, so the same name resolves to two elements.
 * The sidebar anchors carry `data-sidebar="menu-button"`, which scopes it.
 */
export function sidebarLink(page: Page, key: string) {
  return page.locator('a[data-sidebar="menu-button"]', { hasText: t(key) });
}

/**
 * No seed account — shared or isolated tenant — is entitled to `ai.chat`
 * (personal `lite` / org `launch`, neither grants it), so the reset cases below
 * would take an entitlement early-return and assert nothing. Fulfilling the
 * feature query makes entitlement deterministic and lets the real page render.
 * Registered before the first navigation so the value is fixed for the dashboard
 * shell and the AI page alike; the locked branch is covered by the #375
 * plan-gate suite.
 */
export async function mockAiChatEntitled(page: Page) {
  await page.route('**/api/v1/features/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        statusCode: 200,
        data: { features: ['ai.chat'], rollout: {} },
      }),
    }),
  );
}
