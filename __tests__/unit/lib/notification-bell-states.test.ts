import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #664 review: a failed read must not look like "no notifications" with a badge of 0, the count
// is announced, and the user menu has its entry back.

const read = (path: string) => readFileSync(path, 'utf8');
const bell = read('apps/web/src/components/layout/notification-bell.tsx');
const menu = read('apps/web/src/components/layout/user-menu-content.tsx');

describe('notification bell', () => {
  it('shows an error with a retry before the empty state', () => {
    expect(bell).toContain('isError');
    expect(bell.indexOf("t('load_error')")).toBeGreaterThan(-1);
    expect(bell.indexOf("t('load_error')")).toBeLessThan(bell.indexOf("t('empty')"));
    expect(bell).toContain('refetch()');
  });

  it('announces the unread count politely', () => {
    expect(bell).toContain('aria-live="polite"');
  });

  it('opens from the user menu', () => {
    expect(bell).toContain('OPEN_NOTIFICATIONS_EVENT');
    expect(menu).toContain('dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT))');
    expect(menu).not.toContain('TODO(notifications)');
  });

  it.each(['pl', 'en'])('%s has the strings', (locale) => {
    const json = JSON.parse(read(`apps/web/src/i18n/messages/${locale}.json`));
    expect(json.DashboardLayout.notifications).toBeTruthy();
    expect(json.Notifications.load_error).toBeTruthy();
    expect(json.Notifications.retry).toBeTruthy();
  });
});
