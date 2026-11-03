import type { Page } from '@playwright/test';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

const getNested = (obj: Record<string, unknown>, keyPath: string): unknown =>
  keyPath.split('.').reduce<unknown>((prev, curr) => {
    if (typeof prev !== 'object' || prev === null || !(curr in prev)) return undefined;
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
