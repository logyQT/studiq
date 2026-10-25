'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface BreadcrumbEntry {
  label: string;
  /** Id of the component that published the label, so a late unmount cannot wipe a fresh one. */
  owner: string;
}

interface BreadcrumbContextValue {
  /** segment value -> human label */
  names: Record<string, string>;
  publish: (segment: string, label: string, owner: string) => void;
  release: (segment: string, owner: string) => void;
}

/**
 * No-op defaults: a page rendered outside `DashboardLayout` (or in a unit test)
 * must not crash on `useBreadcrumbLabel`.
 */
const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  names: {},
  publish: () => {},
  release: () => {},
});

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Record<string, BreadcrumbEntry>>({});

  const publish = useCallback((segment: string, label: string, owner: string) => {
    setEntries((previous) => {
      const current = previous[segment];
      if (current?.label === label && current?.owner === owner) return previous;
      return { ...previous, [segment]: { label, owner } };
    });
  }, []);

  const release = useCallback((segment: string, owner: string) => {
    setEntries((previous) => {
      // During a transition the incoming page may mount before the outgoing one
      // unmounts; only the owner may delete its own label.
      if (previous[segment]?.owner !== owner) return previous;
      const next = { ...previous };
      delete next[segment];
      return next;
    });
  }, []);

  const names = useMemo(() => {
    const result: Record<string, string> = {};
    for (const [segment, entry] of Object.entries(entries)) result[segment] = entry.label;
    return result;
  }, [entries]);

  const value = useMemo(() => ({ names, publish, release }), [names, publish, release]);

  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

export function useBreadcrumbContext(): BreadcrumbContextValue {
  return useContext(BreadcrumbContext);
}
