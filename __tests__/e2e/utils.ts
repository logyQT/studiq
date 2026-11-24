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
 * The post-login dashboard, whichever area the caller's permissions resolve.
 *
 * `/login` → `/dashboard` picks `/app`, `/edu` or `/manage` from the active
 * org's permission map (ADR-0015 §7.1), so the same seeded account lands in
 * different areas depending on its role keys — a spec that waits for one area
 * hangs on the landing chain instead of failing on the page it is about. A spec
 * that needs an area navigates to it explicitly once this resolves.
 *
 * 15 s: the landing chain (document → /dashboard → orgs/permissions → area)
 * outlives Playwright's 6 s navigation default.
 */
export async function waitForDashboardArea(page: Page): Promise<void> {
  await page.waitForURL(/\/(app|edu|manage)(\/|$)/, { timeout: 15_000 });
}
