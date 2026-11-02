import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #655 review: a failed read of the dashboard must show an error with a retry, never the
// "nothing to do" copy of an empty dashboard.

const read = (path: string) => readFileSync(path, 'utf8');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** One namespace of a message file, failing loudly when the file no longer has it. */
function messageNamespace(path: string, namespace: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(read(path));
  if (!isRecord(parsed)) throw new Error('the message file is not an object');
  const entries = parsed[namespace];
  if (!isRecord(entries)) throw new Error(`${namespace} is missing from the message file`);
  return entries;
}

describe('student dashboard error states', () => {
  const cards = ['continue-card', 'due-progress-card', 'recent-activity-card'].map((name) =>
    read(`apps/web/src/components/app/dashboard/${name}.tsx`),
  );
  const page = read('apps/web/src/app/(frontend)/app/page.tsx');

  it.each(cards.map((c, i) => [i, c] as const))(
    'card %i renders the error before the empty state',
    (_i, source) => {
      const error = source.indexOf('<CardError');
      expect(error).toBeGreaterThan(-1);
      expect(source.search(/_(empty|none)'/)).toBeGreaterThan(error);
    },
  );

  it('the page passes the failure and a retry to the three cards', () => {
    expect(page).toContain('isError={overviewError}');
    expect(page).toContain('isError={statsError || overviewError}');
    expect(page.match(/onRetry=/g)?.length).toBe(3);
  });

  it('the upcoming assignments card stays independent of the overview request', () => {
    expect(
      read('apps/web/src/components/app/dashboard/upcoming-assignments-card.tsx'),
    ).not.toContain('overview');
  });

  it.each(['pl', 'en'])('%s has the error strings', (locale) => {
    const messages = messageNamespace(`apps/web/src/i18n/messages/${locale}.json`, 'AppDashboard');
    expect(messages.load_error).toBeTruthy();
    expect(messages.retry).toBeTruthy();
  });
});
