#!/usr/bin/env bun
/**
 * ADR numbering guard, wired into `bun run lint` (see package.json), which the
 * `checks` job in `.github/workflows/verify.yml` runs on every PR. It costs one
 * `readdirSync` plus a `readFileSync` per ADR — no install, no Supabase.
 *
 * An ADR number is a permanent identifier: docs, code comments and PRs link
 * records by filename (`0009-admin-is-internal-not-deployed.md`) and by number
 * (`ADR-0009`). So the directory has to stay a gapless, duplicate-free sequence:
 *
 *   - `NNNN-kebab-case-slug.md`, exactly four digits, lowercase kebab-case slug.
 *     `7-foo.md`, `00007-foo.md`, `0007_Foo.md` and `0007.md` all fail.
 *   - Numbers are unique — two `0007-*.md` files fail (this is the bug the guard
 *     exists for; a duplicate silently makes `ADR-0007` ambiguous).
 *   - Numbers are consecutive from `0001` — `0001, 0002, 0004` fails (`0003` is
 *     missing), and so does `0000`. Gaps are not "reserved for later": taking the
 *     next free number at the end is what keeps two concurrent PRs from both
 *     claiming the same one.
 *   - The title's number is the filename's number — a copied ADR that still says
 *     the old `# ADR-NNNN:` after being saved under a different number fails.
 *   - Intra-directory links resolve — a renumber/rename that forgets
 *     `[ADR-0009](0009-old-name.md)` leaves a dead link, so it fails too.
 *
 * Not checked on purpose: the slug's wording (rename/reword freely, the number
 * is the identifier) and supersession semantics (`Status: Superseded by …` is a
 * judgement call, not a numbering fact).
 *
 * Usage:
 *   bun scripts/check-adr-numbering.ts              # check docs/decisions
 *   bun scripts/check-adr-numbering.ts <directory>  # check another directory
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_ADR_DIR = 'docs/decisions';
// Four digits, a dash, a lowercase kebab-case slug, `.md`. Lowercase-only also
// keeps the set portable: `0003-Foo.md` and `0003-foo.md` cannot coexist on a
// case-insensitive filesystem, so allowing either would make the guard depend
// on the machine it runs on.
const ADR_FILE_RE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
// The H1 convention is `# ADR-0009: Title`; the number must match the filename.
const ADR_HEADING_RE = /^#\s+ADR-(\d{4})\b/;
// ADR cross-links are relative targets in the same directory.
const ADR_LINK_RE = /\]\(\s*<?(?:\.\/)?(\d{4}-[a-z0-9-]+\.md)(?:#[^)\s>]*)?>?\s*\)/g;
// Non-ADR files allowed alongside the records. Deliberately tiny: an index or
// template belongs in a slug-suffixed ADR or outside this directory.
const ALLOWED_NON_ADR_FILES = new Set(['README.md']);

const adrDir = resolve(process.argv[2] ?? DEFAULT_ADR_DIR);
const errors: string[] = [];

let entries: { name: string; isDirectory: () => boolean }[];
try {
  entries = readdirSync(adrDir, { withFileTypes: true });
} catch (error) {
  // A missing directory would silently disable the guard, so it fails loudly.
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  errors.push(
    code === 'ENOENT'
      ? `${adrDir} does not exist — restore the ADR directory so numbering can be checked.`
      : `cannot read ${adrDir}: ${error instanceof Error ? error.message : String(error)}`,
  );
  entries = [];
}

type Adr = { file: string; number: string };

const adrs: Adr[] = [];
const present = new Set<string>();

for (const entry of entries) {
  const { name } = entry;
  // Editor and OS droppings (`.DS_Store`, `.gitkeep`) are not records.
  if (name.startsWith('.')) continue;

  if (entry.isDirectory()) {
    errors.push(`${name}/ — ADRs are flat files in this directory, not folders.`);
    continue;
  }
  present.add(name);

  if (ALLOWED_NON_ADR_FILES.has(name)) continue;

  const match = ADR_FILE_RE.exec(name);
  if (!match) {
    errors.push(`${name} — expected NNNN-kebab-case-slug.md (four digits, dash, lowercase slug).`);
    continue;
  }
  adrs.push({ file: name, number: match[1] as string });
}

// Duplicate numbers: two records claiming the same ADR-NNNN.
const byNumber = new Map<string, Adr[]>();
for (const adr of adrs) {
  const siblings = byNumber.get(adr.number);
  if (siblings) siblings.push(adr);
  else byNumber.set(adr.number, [adr]);
}
for (const [number, siblings] of [...byNumber].sort()) {
  if (siblings.length < 2) continue;
  errors.push(
    `ADR-${number} is used by ${siblings.length} files: ${siblings
      .map((s) => s.file)
      .sort()
      .join(', ')} — renumber the newer record to the next free number.`,
  );
}

// Gaps: numbering is a sequence from 0001 with no holes and no 0000.
const numbers = [...byNumber.keys()].map(Number).sort((a, b) => a - b);
if (numbers.includes(0)) {
  errors.push('ADR-0000 — numbering starts at 0001.');
}
const highest = numbers[numbers.length - 1] ?? 0;
const used = new Set(numbers);
const missing: number[] = [];
for (let n = 1; n <= highest; n += 1) {
  if (!used.has(n)) missing.push(n);
}
for (const range of toRanges(missing)) {
  errors.push(
    `ADR numbering has a gap: ${range} ${range.includes('–') ? 'are' : 'is'} missing — numbers are consecutive, never reserved or skipped.`,
  );
}

// Title number must match the filename number, and the file must start with the
// H1 (a copy-pasted ADR keeps its old number otherwise).
for (const adr of adrs) {
  let content: string;
  try {
    content = readFileSync(join(adrDir, adr.file), 'utf8');
  } catch (error) {
    errors.push(
      `${adr.file} — cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    continue;
  }

  const firstLine =
    content
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? '';
  const heading = ADR_HEADING_RE.exec(firstLine);
  if (!heading) {
    errors.push(
      `${adr.file} — must start with "# ADR-${adr.number}: <title>" (found ${JSON.stringify(firstLine.slice(0, 60))}).`,
    );
  } else if (heading[1] !== adr.number) {
    errors.push(
      `${adr.file} — title says ADR-${heading[1]} but the filename says ADR-${adr.number}.`,
    );
  }

  for (const link of content.matchAll(ADR_LINK_RE)) {
    const target = link[1] as string;
    if (!present.has(target)) {
      errors.push(`${adr.file} — links to ${target}, which does not exist in this directory.`);
    }
  }
}

if (errors.length > 0) {
  console.error(`✖ ADR numbering check failed (${errors.length} problem(s) in ${adrDir}):\n`);
  for (const error of errors) console.error(`  ${error}`);
  console.error('\nFixes:');
  console.error('  - add the next number (highest + 1) and rename the file to NNNN-kebab-slug.md');
  console.error('  - never reuse, renumber or skip a number; fix links to a renamed file');
  console.error('  - keep the H1 in step: "# ADR-NNNN: <title>"');
  process.exit(1);
}

const span = numbers.length > 0 ? `0001–${String(highest).padStart(4, '0')}` : 'empty';
console.log(`✓ ADR numbering is sequential and unique (${adrs.length} record(s), ${span}).`);

/** Collapse numbers into human-readable ranges, e.g. [3,4,5,9] → 0003–0005, 0009. */
function toRanges(values: number[]): string[] {
  const ranges: string[] = [];
  let start: number | undefined;
  let previous: number | undefined;

  for (const value of values) {
    if (start !== undefined && previous !== undefined && value === previous + 1) {
      previous = value;
      continue;
    }
    if (start !== undefined && previous !== undefined) ranges.push(formatRange(start, previous));
    start = value;
    previous = value;
  }
  if (start !== undefined && previous !== undefined) ranges.push(formatRange(start, previous));
  return ranges;
}

function formatRange(start: number, end: number): string {
  const format = (n: number) => String(n).padStart(4, '0');
  return start === end ? format(start) : `${format(start)}–${format(end)}`;
}
