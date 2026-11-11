#!/usr/bin/env bun
/**
 * ADR integrity guard, wired into `bun run lint` (see package.json), which the
 * `checks` job in `.github/workflows/verify.yml` runs on every PR. It costs one
 * `readdirSync` per ADR directory plus one `readFileSync` per record and per
 * git-tracked file — no install, no Supabase.
 *
 * An ADR number is a permanent identifier: docs, code comments, tests and PRs
 * cite records by filename (`0009-admin-is-internal-not-deployed.md`) and by
 * number (`ADR-0009`). So the directory has to stay a gapless, duplicate-free
 * sequence, and every reference has to keep resolving:
 *
 *   - `NNNN-kebab-case-slug.md`, exactly four digits, lowercase kebab-case slug.
 *     `7-foo.md`, `00007-foo.md`, `0007_Foo.md` and `0007.md` all fail.
 *   - Numbers are unique — two `0007-*.md` files fail (this is the bug the guard
 *     exists for; a duplicate silently makes `ADR-0007` ambiguous).
 *   - Numbers are consecutive from `0001` — `0001, 0002, 0004` fails (`0003` is
 *     missing), and so does `0000`. Gaps are not "reserved for later": taking the
 *     next free number at the end is what keeps two concurrent PRs from both
 *     claiming the same one. Deleting a mid-sequence record is not a renumber:
 *     restore it (or a tombstone) or reuse its number.
 *   - The title's number is the filename's number — a copied ADR that still says
 *     the old `# ADR-NNNN:` after being saved under a different number fails.
 *   - Every link that resolves into this directory exists — a rename that only
 *     updates the record itself leaves `[ADR-0009](0009-old-name.md)` dead in
 *     another ADR, a `README.md` (`docs/decisions/0009-old-name.md`) or a plan
 *     (`../decisions/0009-old-name.md`).
 *   - Every `ADR-NNNN` citation in a git-tracked file matches a record. A
 *     renamed file is not always linked; prose and code comments name the
 *     record by number too, and deleting the highest number leaves no gap to
 *     catch those.
 *
 * Not checked on purpose: the slug's wording (rename/reword freely, the number
 * is the identifier), supersession semantics (`Status: Superseded by …` is a
 * judgement call, not a numbering fact), and PR bodies (not in the checkout).
 *
 * Usage:
 *   bun scripts/check-adr-numbering.ts              # check this checkout
 *   bun scripts/check-adr-numbering.ts <repo-root>  # check another checkout
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const adrDir = join(root, 'docs', 'decisions');
// Four digits, a dash, a lowercase kebab-case slug, `.md`. Lowercase-only also
// keeps the set portable: `0003-Foo.md` and `0003-foo.md` cannot coexist on a
// case-insensitive filesystem, so allowing either would make the guard depend
// on the machine it runs on.
const ADR_FILE_RE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
// The H1 convention is `# ADR-0009: Title`; the number must match the filename.
const ADR_HEADING_RE = /^#\s+ADR-(\d{4})\b/;
// Any Markdown link target, e.g. `[x](0009-a.md#status)` or `[x](<a b.md>)`.
const MARKDOWN_LINK_RE = /\]\(\s*<?([^)\s>]+)>?\s*\)/g;
// A target that names an ADR file. It still has to resolve into `adrDir`.
const ADR_TARGET_RE = /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
// A prose/code citation, e.g. `ADR-0009`.
const ADR_CITATION_RE = /\bADR-(\d{4})\b/g;
// Non-ADR files allowed alongside the records. Deliberately tiny: an index or
// template belongs in a slug-suffixed ADR or outside this directory.
const ALLOWED_NON_ADR_FILES = new Set(['README.md']);
// Extensions that are never UTF-8 text; decoding them would only hide matches.
const BINARY_EXT_RE =
  /\.(?:png|jpe?g|gif|webp|avif|bmp|tiff|ico|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|bz2|xz|tar|mp[34]|webm|ogg|wav|wasm|so|dylib|dll|exe|class|jar|lockb|sqlite3?)$/i;

const errors: string[] = [];
const numbers = new Set<string>();
let highest = 0;
let adrDirReadable = false;

let entries: { name: string; isDirectory: () => boolean }[];
try {
  entries = readdirSync(adrDir, { withFileTypes: true });
  adrDirReadable = true;
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

for (const entry of entries) {
  const { name } = entry;
  // Editor and OS droppings (`.DS_Store`, `.gitkeep`) are not records.
  if (name.startsWith('.')) continue;

  if (entry.isDirectory()) {
    errors.push(`${name}/ — ADRs are flat files in this directory, not folders.`);
    continue;
  }

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
  numbers.add(adr.number);
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
const sorted = [...byNumber.keys()].map(Number).sort((a, b) => a - b);
if (sorted.includes(0)) {
  errors.push('number 0000 is not an ADR number — numbering starts at 0001.');
}
highest = sorted[sorted.length - 1] ?? 0;
const used = new Set(sorted);
const missing: number[] = [];
for (let n = 1; n <= highest; n += 1) {
  if (!used.has(n)) missing.push(n);
}
for (const range of toRanges(missing)) {
  errors.push(
    `ADR numbering has a gap: ${range} ${range.includes('–') ? 'are' : 'is'} missing — numbers are consecutive. ` +
      'Deleted a record? restore it (or a tombstone) at that number, or reuse the number for the next ADR; ' +
      'do not renumber the records after it.',
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
}

// Links and numeric citations live outside the directory too: `README.md`,
// `docs/**`, code comments and tests all name records. Scan the git index so an
// untracked scratch file cannot trip the gate but a plain `git add` is enough
// for a candidate to be seen before it is committed.
if (adrDirReadable) {
  for (const file of trackedFiles()) {
    if (BINARY_EXT_RE.test(file)) continue;

    const filePath = join(root, file);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      errors.push(`${file} — cannot be read for the ADR reference scan.`);
      continue;
    }

    const lines = content.split('\n');
    const inAdrDir = isInsideAdrDir(filePath);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      // An ADR's H1 is validated above; it is a heading, not a citation.
      if (!(inAdrDir && ADR_HEADING_RE.test(line.trim()))) {
        for (const citation of line.matchAll(ADR_CITATION_RE)) {
          const number = citation[1] as string;
          if (!numbers.has(number)) {
            errors.push(
              `${file}:${index + 1} cites ADR-${number}, but no docs/decisions/${number}-*.md exists.`,
            );
          }
        }
      }

      for (const link of line.matchAll(MARKDOWN_LINK_RE)) {
        const href = link[1] as string;
        // External URLs and in-page anchors are not records.
        if (href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
        const path = href.split('#')[0]?.split('?')[0] ?? '';
        if (!ADR_TARGET_RE.test(basename(path))) continue;

        const target = path.startsWith('/')
          ? resolve(root, `.${path}`)
          : resolve(dirname(filePath), path);
        // Only links that land in the ADR directory are this guard's business;
        // a same-named file elsewhere in the repo is just a link.
        if (!isInsideAdrDir(target)) continue;
        if (!statSync(target, { throwIfNoEntry: false })?.isFile()) {
          errors.push(
            `${file}:${index + 1} links to ${href}, which does not exist in docs/decisions/.`,
          );
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`✖ ADR numbering check failed (${errors.length} problem(s)):\n`);
  for (const error of errors) console.error(`  ${error}`);
  console.error('\nFixes:');
  console.error(
    '  - new record? use the next number (highest + 1) and rename it NNNN-kebab-slug.md',
  );
  console.error(
    '  - deleted a record mid-sequence? restore it (or a tombstone) at its number, or reuse that number',
  );
  console.error(
    '  - renamed a record? update its links and every ADR-NNNN citation; do not renumber',
  );
  console.error('  - keep the H1 in step: "# ADR-NNNN: <title>"');
  process.exit(1);
}

const span = sorted.length > 0 ? `0001–${String(highest).padStart(4, '0')}` : 'empty';
console.log(`✓ ADR numbering is sequential and unique (${adrs.length} record(s), ${span});`);
console.log('  links and ADR-NNNN citations resolve.');

/** Git-tracked files, relative to the repository root. */
function trackedFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
      .split('\0')
      .filter((file) => file.length > 0);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    errors.push(`cannot list git-tracked files for the ADR reference scan (${reason}).`);
    return [];
  }
}

/** Whether `target` resolves inside the ADR directory. */
function isInsideAdrDir(target: string): boolean {
  const rel = relative(adrDir, target);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

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
