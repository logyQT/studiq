/**
 * The `-t` filter for a test title written by a human.
 *
 * `vitest run -t` builds a `RegExp` from the value, so a title is a pattern:
 * `clamps a (negative) value` matches `clamps a negative value`, and a title
 * with brackets or `+` can match nothing at all. That read as `ERROR — 0
 * executed` for a perfectly good proof (#1492).
 *
 * vitest also matches the pattern against the test's **full** name, which is the
 * suite path and the title joined by ` > `, and it never exposes the bare title
 * to the filter. A literal `^title$` would therefore match only a top-level
 * test, so the suite path stays open and the title's own (last) segment is the
 * part that must match exactly.
 */
export function exactTitleFilter(title: string): string {
  const literal = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^(?:.* > )?${literal}$`;
}
