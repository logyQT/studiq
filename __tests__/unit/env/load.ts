import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Load a real `scripts/env` module for a pure unit test.
 *
 * `scripts/**` has no alias (the phase-1 tests spawn the CLI by path), and
 * `__tests__` may not use relative specifiers, so the module is imported by an
 * absolute file URL. This keeps the tests against the shipped code instead of
 * a copy.
 */
export async function loadEnvModule<T>(relativePath: string): Promise<T> {
  // The dynamic import is `any`; assigning it to the caller's structural type
  // avoids an unsafe assertion while still exercising the shipped module.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- dynamic module boundary
  return import(pathToFileURL(join(REPO_ROOT, 'scripts', 'env', relativePath)).href);
}
