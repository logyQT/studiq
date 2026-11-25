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

function readSettings(): PrintSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (typeof parsed === 'object' && parsed !== null) {
        return { ...DEFAULT_SETTINGS, ...parsed };
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
 * The first render always holds the defaults and the stored settings arrive in an effect.
 * The server has no `localStorage`, and React does not patch attributes that differ at
 * hydration, so reading it during the first render left the switches showing the defaults
 * while the state held the saved values (#852).
 */
export function usePrintSettings() {
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(readSettings());
  }, []);

  const updateSetting = (key: keyof PrintSettings, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const saveSettings = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  };

  return { settings, updateSetting, saveSettings };
}
