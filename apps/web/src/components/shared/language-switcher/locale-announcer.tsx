'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type AnnounceLocaleChange = (message: string) => void;

const LocaleAnnounceContext = createContext<AnnounceLocaleChange | null>(null);

/** Long enough for a screen reader to finish the sentence, short enough not to linger. */
const CLEAR_AFTER_MS = 5_000;

/**
 * Shell-level polite live region for locale changes (#634).
 *
 * It is mounted once in the root layout — outside the popover, which unmounts
 * on selection — so the announcement survives both the panel closing and the
 * `router.refresh()` that follows. The message is passed in already translated
 * in the *pre-switch* locale, so the refresh cannot re-translate it.
 */
export function LocaleAnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [announcement, setAnnouncement] = useState<{ seq: number; message: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback<AnnounceLocaleChange>((message) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // A new sequence number remounts the text node so an identical message is
    // announced again instead of being swallowed as "no change".
    setAnnouncement((previous) => ({ seq: (previous?.seq ?? 0) + 1, message }));
    timerRef.current = setTimeout(() => setAnnouncement(null), CLEAR_AFTER_MS);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const value = useMemo(() => announce, [announce]);

  return (
    <LocaleAnnounceContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement && <span key={announcement.seq}>{announcement.message}</span>}
      </div>
    </LocaleAnnounceContext.Provider>
  );
}

const noop: AnnounceLocaleChange = () => {};

export function useAnnounceLocale(): AnnounceLocaleChange {
  return useContext(LocaleAnnounceContext) ?? noop;
}
