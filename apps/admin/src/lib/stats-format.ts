const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Storage size for people: 1024-based, one decimal from KB up, "0 B" for nothing. */
export function formatBytes(bytes: number): string {
  const value = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (value < 1024) return `${Math.round(value)} B`;

  let unit = 0;
  let scaled = value;
  while (scaled >= 1024 && unit < UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(1)} ${UNITS[unit]}`;
}

/** Number with the locale's thousands separator, for the stat cards. */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Bar heights, as a percentage of the tallest bar, for a small chart of daily counts. A day with
 * any activity is never drawn at less than `floor` percent, so a single event next to a huge
 * day does not vanish; a day with none is 0.
 */
export function barHeights(values: readonly number[], floor = 4): number[] {
  const max = Math.max(0, ...values);
  if (max === 0) return values.map(() => 0);
  return values.map((value) => (value <= 0 ? 0 : Math.max(floor, Math.round((value / max) * 100))));
}

/** Sum of a series, for the chart caption. */
export function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
