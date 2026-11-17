import { randomBytes } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';

/**
 * Write a file a concurrent reader never sees half-written.
 *
 * The temporary file is created exclusively (`wx`) beside the target, so the
 * rename is on the same filesystem and atomic; a failed rename removes the
 * temporary instead of leaving a stray `.tmp` behind. Callers own the parent
 * directory and the file's mode.
 */
export function atomicWriteFile(path: string, contents: string): void {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, contents, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}
