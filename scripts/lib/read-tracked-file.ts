import { lstatSync, readFileSync } from 'node:fs';

/**
 * Reads a path listed by `git ls-files`, for the guards that scan tracked files.
 *
 * The index can still list a file that is gone from the checkout: after a plain
 * `rm`, and in the pre-commit hook of `git commit -a` for a guard that reads the
 * repository's own index instead of the hook's temporary one (#1412). Such a file
 * has no content to check, so the result is `null`.
 *
 * `lstatSync` does not follow symlinks, so a dangling one still has an entry: it
 * throws on read, like every other file that exists but cannot be read.
 */
export function readTrackedFile(path: string): string | null {
  if (!lstatSync(path, { throwIfNoEntry: false })) return null;
  return readFileSync(path, 'utf8');
}
