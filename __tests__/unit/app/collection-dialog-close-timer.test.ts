import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1560: a close keeps the edited row for the dialog's 200 ms exit animation. Re-opening a row
 * inside that window used to let the pending clear fire anyway: the keyed body showed the new
 * row, but the title and the save mode flipped to create. A new open now cancels the pending
 * clear, and the deferred clear ignores a close that a newer open has superseded.
 *
 * This is a source check: the unit environment has no DOM or fake timers driving the hook, so
 * the ordering of the timer against the open is pinned where it is written. The served case is
 * the QA corpus's.
 */
const SCREEN = path.join(process.cwd(), 'apps/web/src/components/shared/collection-screen.tsx');

describe('content dialog close timer (#1560)', () => {
  const source = readFileSync(SCREEN, 'utf8');

  it('cancels the pending close when the form opens again', () => {
    expect(source).toMatch(
      /const openDialog = useCallback\(\s*\(item: T \| null\) => \{\s*cancelPendingClear\(\);/,
    );
    expect(source).toMatch(
      /const cancelPendingClear = useCallback\(\(\) => \{[\s\S]*?clearTimeout\(/,
    );
  });

  it('ignores a close that a newer open has superseded', () => {
    expect(source).toMatch(
      /closeTimer\.current = setTimeout\(\(\) => \{[\s\S]*?if \(openNonceRef\.current === closedAt\) setEditing\(null\);/,
    );
  });

  it('clears the pending close when the screen unmounts', () => {
    expect(source).toContain('useEffect(() => cancelPendingClear, [cancelPendingClear]);');
  });

  it('routes every open through the cancelling action', () => {
    expect(source).toContain('const openCreate = () => openDialog(null);');
    expect(source).toContain('const openEdit = (item: T) => openDialog(item);');
    expect(source).toContain('if (open) screen.openDialog(screen.editing);');
  });
});
