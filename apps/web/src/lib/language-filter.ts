/**
 * Search matching for the language switcher (#634). Pure — no React — so it
 * runs in Node unit tests. Used as cmdk's `filter`.
 */

/** Lower-case and strip diacritics, so "espanol" finds Español and "ukrainski" finds ukraiński. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Predictable matching instead of cmdk's scattered-letter fuzzy score (which
 * matches letters spread across unrelated names): a query matches when a word of the endonym,
 * a localized name, an alias or the code *starts with* it; whole-word prefixes
 * rank above matches inside a word.
 */
export function languageFilter(value: string, search: string, keywords: string[] = []): number {
  const query = normalize(search);
  if (!query) return 1;
  const words = [value, ...keywords].flatMap((term) => normalize(term).split(/[\s-]+/));
  if (words.some((word) => word.startsWith(query))) return 1;
  if (words.some((word) => word.includes(query))) return 0.5;
  return 0;
}
