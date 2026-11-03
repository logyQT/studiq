'use client';

import { useCallback, useEffect, useState } from 'react';

export function usePersistedState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        // The entry was written by the `JSON.stringify(state)` effect below, so it
        // already holds this hook's own `T`; there is no runtime schema to check.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- restores the value this same hook stored as `T`
        return JSON.parse(raw) as T;
      }
    } catch {
      /* ignore */
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [key, state]);

  const setPersisted = useCallback((value: T | ((prev: T) => T)) => {
    setState(value);
  }, []);

  return [state, setPersisted];
}
