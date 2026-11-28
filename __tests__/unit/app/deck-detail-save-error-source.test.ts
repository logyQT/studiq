import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1560: the deck Edit dialog on the deck page closed BEFORE the save was awaited, so a 403
 * unmounted the form and the user lost the edit; its catch also used the page's flashcard copy
 * ("Nie udało się zapisać fiszki"). The dialog now closes only after the save lands, and the
 * refusal goes to the form with the deck's own line.
 *
 * This is a source check: the ordering is the defect, and the unit environment has no DOM to
 * click the menu. The served behaviour is the QA corpus's; the rendered error line is pinned by
 * `content-dialog-save-error.test.ts`.
 */
const PAGE = path.join(
  process.cwd(),
  'apps/web/src/components/flashcards/screens/deck-detail-screen.tsx',
);

/** The body of `handleDeckUpdate`, between its declaration and the next handler. */
function updateHandler(source: string): string {
  const start = source.indexOf('async function handleDeckUpdate');
  const end = source.indexOf('async function handleDeckDelete');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('deck edit save failure (#1560)', () => {
  const handler = updateHandler(readFileSync(PAGE, 'utf8'));

  it('closes the deck dialog only after the save succeeds', () => {
    const save = handler.indexOf('await updateDeck.mutateAsync');
    const close = handler.indexOf('deckEditOpen: false');

    expect(save).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(save);
  });

  it('keeps the refusal in the form and names the deck', () => {
    expect(handler).toContain('deckEditError: saveFailureMessage(');
    expect(handler).toContain("t('deck_save_failed')");
    expect(handler).not.toContain("toast.error(t('save_failed'))");
  });
});
