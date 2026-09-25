/**
 * Import-path guard, wired into `bun run lint` (see package.json).
 *
 * Two rule sets:
 *
 * 1. Alias roots (`apps/web/src`, `apps/admin/src`, `__tests__`) — bans **all**
 *    relative module specifiers (`./`, `../`, `../../`). Use full aliases:
 *      - `@/...`     → `src/...`       (tsc, Next, Vitest, Playwright)
 *      - `#test/...` → `__tests__/...` (Vitest config, tsconfig paths, Playwright)
 *    Intentionally strict: even asset imports (`.css`, `.svg`, ...) must use the
 *    full alias so paths stay unambiguous and move-proof.
 *
 * 2. Packages (`packages/<name>/src`) — relative imports **within** a package are
 *    allowed (a workspace `@/*` alias would resolve to the consuming app, not
 *    the package), but a relative specifier may never leave its own package.
 *    Cross-package imports go through workspace names: `@studiq/server/...`,
 *    `@studiq/authz`, `@studiq/ui`.
 *
 * Usage: `bun scripts/check-import-paths.ts`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ALIAS_ROOTS = ['apps/web/src', 'apps/admin/src', '__tests__'];
const PACKAGES_ROOT = 'packages';
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// Static `from '...'`, side-effect `import '...'`, dynamic `import('...')`, `require('...')`
const RELATIVE_IMPORT_RE = /(?:from\s+|import[\s(]+|require\s*\()['"](\.{1,2}(?:\/[^'"\n]*)?)['"]/g;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (CODE_EXT.test(entry)) {
      yield full;
    }
  }
}

function relativeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  RELATIVE_IMPORT_RE.lastIndex = 0;
  const hits: string[] = [];
  for (const match of source.matchAll(RELATIVE_IMPORT_RE)) {
    hits.push(match[1]);
  }
  return [...new Set(hits)];
}

// Rule 1 — alias roots: no relative imports at all.
const aliasViolations = new Map<string, string[]>();
let aliasCount = 0;

for (const root of ALIAS_ROOTS) {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) continue;
  for (const file of walk(root)) {
    const hits = relativeImports(file);
    if (hits.length > 0) {
      aliasCount += hits.length;
      aliasViolations.set(file, hits);
    }
  }
}

// Rule 2 — packages: relative imports must stay inside their own package.
const boundaryViolations = new Map<string, string[]>();
let boundaryCount = 0;

if (statSync(PACKAGES_ROOT, { throwIfNoEntry: false })?.isDirectory()) {
  for (const pkgEntry of readdirSync(PACKAGES_ROOT)) {
    const packageRoot = join(PACKAGES_ROOT, pkgEntry);
    const srcRoot = join(packageRoot, 'src');
    if (!statSync(srcRoot, { throwIfNoEntry: false })?.isDirectory()) continue;

    for (const file of walk(srcRoot)) {
      const escaping = relativeImports(file).filter(
        (spec) => !resolve(dirname(file), spec).startsWith(resolve(packageRoot) + sep),
      );
      if (escaping.length > 0) {
        boundaryCount += escaping.length;
        boundaryViolations.set(file, escaping);
      }
    }
  }
}

if (aliasCount + boundaryCount > 0) {
  if (aliasCount > 0) {
    console.error(`✖ ${aliasCount} relative import(s) across ${aliasViolations.size} file(s).`);
    console.error('Use full aliases instead: "@/" → src/, "#test/" → __tests__/.\n');
    for (const [file, specifiers] of [...aliasViolations.entries()].sort()) {
      console.error(`  ${relative(process.cwd(), file)}:`);
      for (const spec of specifiers) {
        console.error(`    - ${spec}`);
      }
    }
    console.error('');
  }
  if (boundaryCount > 0) {
    console.error(
      `✖ ${boundaryCount} cross-package relative import(s) across ${boundaryViolations.size} file(s).`,
    );
    console.error(
      'Use workspace names instead: "@studiq/server/...", "@studiq/authz", "@studiq/ui".\n',
    );
    for (const [file, specifiers] of [...boundaryViolations.entries()].sort()) {
      console.error(`  ${relative(process.cwd(), file)}:`);
      for (const spec of specifiers) {
        console.error(`    - ${spec}`);
      }
    }
    console.error('');
  }
  console.error('See AGENTS.md → "Import Paths".');
  process.exit(1);
}

console.log(
  '✓ import path check passed — no relative imports in apps/tests, none crossing a package boundary.',
);
