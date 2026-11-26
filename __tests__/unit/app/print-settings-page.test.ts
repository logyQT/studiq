import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AssignmentSettingsClient from '@/app/(frontend)/edu/assignments/settings/settings-client';
import en from '@/i18n/messages/en.json';

// #852: before the saved settings are read, the page must not show a value or save one.

const hook = vi.hoisted(() => ({ ready: false }));

vi.mock('@/hooks/use-print-settings', () => ({
  usePrintSettings: () => ({
    settings: {
      showNameField: true,
      showClassField: false,
      showDateField: true,
      showPoints: false,
      includeAnswerKey: true,
    },
    ready: hook.ready,
    updateSetting: vi.fn(),
    saveSettings: vi.fn(),
  }),
}));

function render(ready: boolean) {
  hook.ready = ready;
  const html = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', messages: en, timeZone: 'UTC' },
      createElement(AssignmentSettingsClient),
    ),
  );
  const buttons = [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => ({
    isSwitch: tag.includes('role="switch"'),
    checked: tag.includes('aria-checked="true"'),
    disabled: tag.includes(' disabled=""'),
    hidden: / class="(?:[^"]* )?invisible(?: [^"]*)?"/.test(tag),
  }));
  return {
    switches: buttons.filter((button) => button.isSwitch),
    save: buttons.filter((button) => !button.isSwitch),
  };
}

describe('print settings page (#852)', () => {
  it('hides and disables all five switches and Save before the read', () => {
    const { switches, save } = render(false);

    expect(switches.map(({ hidden, disabled }) => [hidden, disabled])).toEqual(
      Array.from({ length: 5 }, () => [true, true]),
    );
    expect(save.map(({ disabled }) => disabled)).toEqual([true]);
  });

  it('shows the values and enables the controls after the read', () => {
    const { switches, save } = render(true);

    expect(switches.map(({ checked }) => checked)).toEqual([true, false, true, false, true]);
    expect(switches.some(({ hidden, disabled }) => hidden || disabled)).toBe(false);
    expect(save.map(({ disabled }) => disabled)).toEqual([false]);
  });
});
