'use client';

import { useEffect, useState } from 'react';

/**
 * Today's date as the dashboard's eyebrow line, in the visitor's time zone.
 *
 * It is formatted after mount. The server runs in its own zone, so a date formatted during
 * render differs from the browser's whenever their calendar days do, and hydration fails
 * (#959). Until then the line holds a non-breaking space, which keeps its height.
 */
export function TodayDate({ locale }: { locale: string }) {
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    setToday(
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date()),
    );
  }, [locale]);

  return (
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
      {today ?? ' '}
    </p>
  );
}
