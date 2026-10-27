import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #656 review: the card must be fresh when the student comes back from studying, must not turn
// a failed load into "no goal" (one click would overwrite a real goal with 0), and has to be
// usable without colour or a mouse.

const card = readFileSync('apps/web/src/components/study/daily-goal-card.tsx', 'utf8');
const progress = readFileSync('packages/ui/src/components/ui/progress.tsx', 'utf8');

describe('DailyGoalCard', () => {
  it('refetches on mount instead of serving the never-stale settings', () => {
    expect(card).toMatch(/url: SETTINGS_URL,\s*staleTime: 0/);
  });

  it('shows an error with a retry and never opens the editor before the goal loaded', () => {
    expect(card).toContain('isError');
    expect(card).toContain("t('load_error')");
    expect(card).toContain('refetch()');
    expect(card).toMatch(/if \(!settings\) return;/);
    expect(card).not.toContain('setValue(String(settings?.');
  });

  it('announces an invalid value as text, not only by colour', () => {
    expect(card).toContain('id="daily-goal-error"');
    expect(card).toContain('role="alert"');
    expect(card).toContain('daily-goal-hint daily-goal-error');
  });

  it('moves focus into the field and back to the trigger', () => {
    expect(card).toContain('inputRef.current?.focus()');
    expect(card).toContain('triggerRef.current?.focus()');
  });

  it('names the presets and marks the current one', () => {
    expect(card).toContain("aria-label={t('preset_label'");
    expect(card).toContain('aria-pressed={parsed === preset}');
  });

  it('puts the edit button in the header action slot of the grid', () => {
    expect(card).toContain('<CardAction>');
    expect(card).not.toContain('flex-row items-start justify-between');
  });

  it('gives the bar its value semantics', () => {
    expect(card).toContain('aria-valuetext=');
    expect(progress).toContain('value={value}');
  });
});

describe('StudyGoal messages', () => {
  for (const locale of ['pl', 'en']) {
    it(`${locale} has every key the card uses`, () => {
      const json = JSON.parse(readFileSync(`apps/web/src/i18n/messages/${locale}.json`, 'utf8'));
      const keys = [...card.matchAll(/\bt\('([a-z_]+)'/g)].map((m) => m[1]);
      for (const key of new Set(keys)) expect(json.StudyGoal[key], key).toBeTruthy();
    });
  }
});
