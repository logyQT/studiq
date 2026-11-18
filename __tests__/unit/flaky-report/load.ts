import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Load the flaky-test ledger for a unit test.
 *
 * `scripts/**` has no alias and `__tests__` may not use relative specifiers, so
 * the module is imported by absolute file URL — the same boundary the `env`
 * tests use. Testing the shipped parser (rather than a copy of it) is the point:
 * the ledger's only input is someone else's JSON shape.
 */
export async function loadFlakyReport(): Promise<{
  parseReport: (raw: unknown) => ObservedTest[];
  aggregate: (reports: { tests: ObservedTest[] }[]) => FlakeEntry[];
}> {
  // The dynamic import is `any`; binding it to the caller's structural type keeps
  // the unsafe value at this module boundary instead of every call site.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- dynamic module boundary
  return import(pathToFileURL(join(REPO_ROOT, 'scripts', 'flaky-report.ts')).href);
}

interface ObservedTest {
  file: string;
  title: string;
  project: string;
  status: string;
  slowestFailureMs?: number;
  error?: string;
}

interface FlakeEntry {
  file: string;
  title: string;
  project: string;
  seenIn: number;
  flaky: number;
  failed: number;
  slowestFailureMs?: number;
  lastError?: string;
  reproduce: string;
}
