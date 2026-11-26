'use client';

import { useEffect, useState } from 'react';

export interface PrintSettings {
  showNameField: boolean;
  showClassField: boolean;
  showDateField: boolean;
  showPoints: boolean;
  includeAnswerKey: boolean;
}

const STORAGE_KEY = 'assignment-print-settings';

const DEFAULT_SETTINGS: PrintSettings = {
  showNameField: true,
  showClassField: true,
  showDateField: true,
  showPoints: true,
  includeAnswerKey: true,
};

/** Only a boolean value of a known setting comes from the saved entry. */
function knownSettings(entry: object): Partial<PrintSettings> {
  return Object.fromEntries(
    Object.entries(entry).filter(
      ([key, value]) => Object.hasOwn(DEFAULT_SETTINGS, key) && typeof value === 'boolean',
    ),
  );
}

function readSettings(): PrintSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (typeof parsed === 'object' && parsed !== null) {
        return { ...DEFAULT_SETTINGS, ...knownSettings(parsed) };
      }
    }
  } catch {
    /* unavailable storage or malformed JSON: the defaults apply */
  }
  return DEFAULT_SETTINGS;
}

/**
 * The device-side print settings of assignments, shared by the settings page and the print view.
 *
 * The first render does not read `localStorage`, because the server has none and React does not
 * patch attributes that differ at hydration (#852). An effect reads it. Until then, `ready` is
 * false and `settings` holds the defaults. The settings page must not show or save them then.
 */
export function usePrintSettings() {
  const [stored, setStored] = useState<PrintSettings | null>(null);

  useEffect(() => {
    setStored(readSettings());
  }, []);

  const updateSetting = (key: keyof PrintSettings, value: boolean) => {
    setStored((prev) => prev && { ...prev, [key]: value });
  };

  /** False when nothing was saved: the settings are not read yet, or storage refused them. */
  const saveSettings = (): boolean => {
    if (!stored) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      return true;
    } catch {
      return false;
    }
  };

  return {
    settings: stored ?? DEFAULT_SETTINGS,
    ready: stored !== null,
    updateSetting,
    saveSettings,
  };
}
