const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

/**
 * "5 minutes ago" / "5 minut temu" in the app locale, for feeds. Pass the locale from
 * `useLocale()` and, in tests, a fixed `now`. Anything under a minute reads "now".
 */
export function formatRelativeTime(value: string | Date, locale: string, now = Date.now()): string {
  const then = (typeof value === 'string' ? new Date(value) : value).getTime();
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = then - now;

  for (const { unit, ms } of UNITS) {
    if (Math.abs(diff) >= ms) return formatter.format(Math.round(diff / ms), unit);
  }
  return formatter.format(0, 'second');
}
