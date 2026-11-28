import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1560: the bank dialog seeded its fields from `initialValues` in an effect keyed on that object,
 * which the screen rebuilds on every render. A parent re-render — the list refetch after a refused
 * save — ran the effect again and put the stored values back, so the group the user had just added
 * disappeared behind the error. The form now seeds once per open, from state that reads the
 * `initialValues` it mounted with, so a re-render cannot discard the edit.
 *
 * A close clears `editing` only after the exit animation, so a reopen inside that window keeps the
 * body mounted. Each open therefore bumps a nonce the dialog uses as the body's key, and a second
 * open always seeds from the row it opened with.
 *
 * This is a source check because the reset only happens on a re-render, which the DOM-free unit
 * environment cannot trigger; the served case is the QA corpus's.
 */
const DIALOG = path.join(
  process.cwd(),
  'apps/web/src/components/questions/shared/question-bank-form-dialog.tsx',
);
const SCREEN = path.join(process.cwd(), 'apps/web/src/components/shared/collection-screen.tsx');

describe('question bank dialog seeds its fields once per open (#1560)', () => {
  const dialog = readFileSync(DIALOG, 'utf8');
  const screen = readFileSync(SCREEN, 'utf8');

  it('keeps no effect that re-seeds the fields when the parent renders again', () => {
    expect(dialog).not.toContain('useEffect');
  });

  it('seeds the field state from the values it opened with', () => {
    expect(dialog).toContain('initialValues ??');
    expect(dialog).toContain('useState(initial.name)');
    expect(dialog).toContain('useState<string[]>(initial.groupIds ?? [])');
  });

  it('mounts the form body inside the dialog content', () => {
    const body = dialog.indexOf('<FormBody');
    expect(body).toBeGreaterThan(-1);
    expect(body).toBeLessThan(dialog.indexOf('</DialogContent>'));
  });

  it('gives every open its own body, so a second open seeds from its own row', () => {
    expect(dialog).toContain('key={bodyKey}');
    expect(screen).toContain('bodyKey: screen.openNonce');
    // Both entries into the dialog — create and edit — go through the action that bumps it.
    expect(screen).toContain('const openCreate = () => openDialog(null);');
    expect(screen).toContain('const openEdit = (item: T) => openDialog(item);');
    expect(screen).toContain('setOpenNonce(nonce);');
  });
});
