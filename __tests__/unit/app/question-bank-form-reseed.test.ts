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
 * This is a source check because the reset only happens on a re-render, which the DOM-free unit
 * environment cannot trigger; the served case is the QA corpus's.
 */
const DIALOG = path.join(
  process.cwd(),
  'apps/web/src/components/questions/shared/question-bank-form-dialog.tsx',
);

describe('question bank dialog seeds its fields once per open (#1560)', () => {
  const source = readFileSync(DIALOG, 'utf8');

  it('keeps no effect that re-seeds the fields when the parent renders again', () => {
    expect(source).not.toContain('useEffect');
  });

  it('seeds the field state from the values it opened with', () => {
    expect(source).toContain('initialValues ??');
    expect(source).toContain('useState(initial.name)');
    expect(source).toContain('useState<string[]>(initial.groupIds ?? [])');
  });

  it('mounts the form body only while the dialog is open', () => {
    expect(source.indexOf('<FormBody')).toBeGreaterThan(source.indexOf('<DialogContent'));
  });
});
