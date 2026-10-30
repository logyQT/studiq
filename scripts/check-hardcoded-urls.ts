/**
 * Hardcoded-local-URL guard, wired into `bun run lint` (see package.json).
 *
 * Runtime code must derive local origins from env (`APP_URL`,
 * `NEXT_PUBLIC_SITE_URL`, `SUPABASE_URL`) or from `getSiteUrl()`, so a
 * per-session VM can move ports/hosts without a code change. This check scans
 * `apps/web/src` and every `packages/<name>/src`, and fails on a literal
 * `localhost:<port>` / `127.0.0.1:<port>` for the dev, QA and admin stacks.
 *
 * `packages/server/src/lib/site-url.ts` is the one intentional local default
 * (the documented fallback for generated URLs).
 *
 * Usage: `bun scripts/check-hardcoded-urls.ts`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const LOCAL_URL_RE = /\b(?:localhost|127\.0\.0\.1):(?:3000|3010|4000|4010|54321|54421)\b/g;
const ALLOWED_FILES = new Set(['packages/server/src/lib/site-url.ts']);

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

const roots = [
  'apps/web/src',
  ...readdirSync('packages').map((pkg) => join('packages', pkg, 'src')),
];
const violations = new Map<string, { line: number; url: string }[]>();

for (const root of roots) {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) continue;
  for (const file of walk(root)) {
    if (ALLOWED_FILES.has(file)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, index) => {
        for (const match of text.matchAll(LOCAL_URL_RE)) {
          const hits = violations.get(file) ?? [];
          hits.push({ line: index + 1, url: match[0] });
          violations.set(file, hits);
        }
      });
  }
}

if (violations.size > 0) {
  const total = [...violations.values()].reduce((sum, hits) => sum + hits.length, 0);
  console.error(`✖ ${total} hardcoded local URL(s) across ${violations.size} file(s).`);
  console.error('Read the origin from env or use getSiteUrl() from @studiq/server/lib/site-url.\n');
  for (const [file, hits] of [...violations.entries()].sort()) {
    console.error(`  ${relative(process.cwd(), file)}:`);
    for (const hit of hits) {
      console.error(`    ${hit.line}: ${hit.url}`);
    }
  }
  console.error('');
  process.exit(1);
}

console.log('✓ hardcoded URL check passed — runtime origins come from env.');
