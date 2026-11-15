const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Storage size for people: 1024-based, one decimal from KB up (locale decimal mark), "0 B" for nothing. */
export function formatBytes(bytes: number, locale = 'en'): string {
  const value = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (value < 1024) return `${Math.round(value)} B`;

  let unit = 0;
  let scaled = value;
  while (scaled >= 1024 && unit < UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(scaled);
  return `${number} ${UNITS[unit]}`;
}

/** Number with the locale's thousands separator, for the stat cards. */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Tallest value in a series, the denominator for `barHeight`. */
export function maxValue(values: readonly number[]): number {
  return Math.max(0, ...values);
}

/**
 * One bar's height, as a percentage of `max`. A day with any activity is never drawn at less
 * than `floor` percent, so a single event next to a huge day does not vanish; a day with none is 0.
 */
export function barHeight(value: number, max: number, floor = 4): number {
  return max === 0 || value <= 0 ? 0 : Math.max(floor, Math.round((value / max) * 100));
}

/** Bar heights for a whole series, as a percentage of the tallest bar. */
export function barHeights(values: readonly number[], floor = 4): number[] {
  const max = maxValue(values);
  return values.map((value) => barHeight(value, max, floor));
}

/** Sum of a series, for the chart caption. */
export function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
