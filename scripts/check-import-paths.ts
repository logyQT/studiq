/**
 * Import-path guard: bans relative module specifiers (`./`, `../`, `../../`) in
 * all `.ts`/`.tsx`/`.js`/`.jsx` files under `src/` and `__tests__/`.
 *
 * Use full aliases instead:
 *   - `@/...`     → `src/...`      (all toolchains: tsc, Next, Vitest, Playwright)
 *   - `#test/...` → `__tests__/...` (Vitest config, tsconfig paths, Playwright)
 *
 * Wired into `bun run lint` (see package.json). Intentionally strict: even
 * asset imports (`.css`, `.svg`, ...) must use the full alias so paths stay
 * unambiguous and move-proof.
 *
 * Usage: `bun scripts/check-import-paths.ts`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['apps/web/src', 'apps/admin/src', '__tests__'];
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

let violations = 0;
const files = new Map<string, string[]>();

for (const root of ROOTS) {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) continue;
  for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8');
    RELATIVE_IMPORT_RE.lastIndex = 0;
    const hits: string[] = [];
    for (const match of source.matchAll(RELATIVE_IMPORT_RE)) {
      hits.push(match[1]);
    }
    if (hits.length > 0) {
      violations += hits.length;
      // Deduplicate specifiers per file for a compact report.
      files.set(file, [...new Set(hits)]);
    }
  }
}

if (violations > 0) {
  console.error(`✖ ${violations} relative import(s) across ${files.size} file(s).`);
  console.error('Use full aliases instead: "@/" → src/, "#test/" → __tests__/.');
  console.error('See AGENTS.md → "Import Paths".\n');
  for (const [file, specifiers] of [...files.entries()].sort()) {
    console.error(`  ${relative(process.cwd(), file)}:`);
    for (const spec of specifiers) {
      console.error(`    - ${spec}`);
    }
  }
  process.exit(1);
}

console.log('✓ import path check passed — no relative imports in src/ or __tests__/.');
