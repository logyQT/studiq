import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The bank form takes the share delta inside the dialog, against the values it opened with
 * (#1557). The screen seeds those values from the stored row. If either step is lost, the dialog
 * submits a defaulted `personal` share and the save un-shares the bank with a 200.
 *
 * This is a source check, not a render test: the unit environment has no DOM, so the behaviour is
 * pinned by `__tests__/integration/question-bank-edit-resave.test.ts`. This pins the wiring that
 * feeds it, the way `manage-seats-read-only-source.test.ts` pins a client page.
 */
const DIALOG = path.join(
  process.cwd(),
  'apps/web/src/components/questions/shared/question-bank-form-dialog.tsx',
);
const SCREEN = path.join(
  process.cwd(),
  'apps/web/src/components/questions/screens/question-bank-management-screen.tsx',
);

describe('question bank share wiring (#1557)', () => {
  const dialog = readFileSync(DIALOG, 'utf8');
  const screen = readFileSync(SCREEN, 'utf8');

  it('takes the share delta in the dialog from the values it opened with', () => {
    expect(dialog).toContain('contentFormPayload(initialValues, {');
  });

  it('seeds the dialog from the stored share', () => {
    expect(screen).toContain('visibility: bank.visibility');
    expect(screen).toContain('groupIds: bank.groupIds ?? []');
  });
});
