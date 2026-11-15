import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { signIn } from '#test/e2e/fixtures/tenant';
import { mockAiChatEntitled, stubAiChat, t } from '#test/e2e/utils';

/**
 * Study notes in the AI chat (#1147): what the assistant's `generate_notes` call looks like in the
 * transcript, the copy button, and the round trip notes → flashcards → a saved deck. The model is
 * not involved: the chat endpoint is answered by the spec with the frames a real turn would
 * stream, and what the tool returns for a given call is covered by
 * `__tests__/unit/agents/tools/generic.test.ts`.
 */

const NOTES = {
  type: 'notes',
  title: 'Photosynthesis basics',
  sections: [
    { heading: 'Light reactions', content: 'Chlorophyll absorbs light in the thylakoids.' },
    { heading: 'Calvin cycle', content: 'Carbon dioxide is fixed into sugar in the stroma.' },
  ],
  keyTerms: [
    { term: 'Chlorophyll', definition: 'The green pigment that absorbs light.' },
    { term: 'Stroma', definition: 'The fluid around the thylakoids.' },
  ],
  summary: 'Plants turn light, water and carbon dioxide into sugar.',
};

const NOTES_CALL = 'call-notes';

/** A turn in which the assistant calls `generate_notes` and then says one sentence. */
const notesTurn = [
  { type: 'start' },
  { type: 'start-step' },
  {
    type: 'tool-input-available',
    toolCallId: NOTES_CALL,
    toolName: 'generate_notes',
    input: { task: 'photosynthesis', title: NOTES.title, sections: NOTES.sections },
  },
  { type: 'tool-output-available', toolCallId: NOTES_CALL, output: NOTES },
  { type: 'finish-step' },
  { type: 'start-step' },
  { type: 'text-start', id: 'txt-0' },
  { type: 'text-delta', id: 'txt-0', delta: 'The notes are ready above.' },
  { type: 'text-end', id: 'txt-0' },
  { type: 'finish-step' },
  { type: 'finish', finishReason: 'stop' },
];

const SAVE_DECK = /Save \d+ cards as deck|Zapisz \d+ fiszk\S* jako talię/i;
const SAVED = /Saved \d+ cards to deck|Zapisano \d+ fiszk\S* do talii/i;

/** Opens the chat, asks for notes and waits for the block the stubbed turn produces. */
async function askForNotes(page: Page) {
  await mockAiChatEntitled(page);
  // The clipboard is stubbed, not granted: permission prompts differ per browser, and the spec
  // only needs to see what the button hands to `writeText`.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          Reflect.set(window, '__copied', text);
          return Promise.resolve();
        },
      },
    });
  });
  const bodies = await stubAiChat(page, notesTurn);
  await signIn(page, 'student');
  await page.goto('/app/ai');

  const input = page.getByPlaceholder(t('AiChatPage.input_placeholder'));
  await expect(input).toBeVisible();
  await input.fill('Make study notes about photosynthesis');
  await input.press('Enter');

  const block = page.getByRole('region', { name: NOTES.title });
  await expect(block).toBeVisible();
  return { block, bodies };
}

test.describe('AI chat study notes (#1147)', () => {
  test('the notes render as a block and the raw tool call stays out of the transcript', async ({
    page,
  }) => {
    const { block } = await askForNotes(page);

    await expect(block.getByRole('heading', { name: 'Light reactions' })).toBeVisible();
    await expect(block.getByText('Chlorophyll absorbs light in the thylakoids.')).toBeVisible();
    await expect(block.getByRole('heading', { name: 'Calvin cycle' })).toBeVisible();
    await expect(
      block.getByRole('heading', { name: t('AiChatPage.notes_key_terms') }),
    ).toBeVisible();
    await expect(block.getByText('The green pigment that absorbs light.')).toBeVisible();
    await expect(block.getByRole('heading', { name: t('AiChatPage.notes_summary') })).toBeVisible();
    await expect(block.getByText(NOTES.summary)).toBeVisible();

    // The assistant's own sentence follows the block, and the call itself is not listed.
    await expect(page.getByText('The notes are ready above.')).toBeVisible();
    await expect(page.getByText(/Wrote notes with|generate_notes/)).toHaveCount(0);
    // No raw translation key leaked into the block.
    await expect(block).not.toContainText('AiChatPage.');
  });

  test('copy hands the notes to the clipboard as Markdown', async ({ page }) => {
    const { block } = await askForNotes(page);

    await block.getByRole('button', { name: t('AiChatPage.notes_copy') }).click();
    await expect(page.getByText(t('AiChatPage.notes_copied'))).toBeVisible();

    const copied = await page.evaluate(() => {
      const text: unknown = Reflect.get(window, '__copied');
      return typeof text === 'string' ? text : '';
    });
    expect(copied).toEqual(expect.stringContaining('# Photosynthesis basics'));
    expect(copied).toEqual(expect.stringContaining('## Light reactions'));
    expect(copied).toEqual(expect.stringContaining('- **Chlorophyll**: The green pigment'));
  });

  test('make flashcards turns the key terms into cards that save as a deck, and nothing before', async ({
    page,
  }) => {
    const { block } = await askForNotes(page);

    // Nothing is written until the user saves: the cards are only offered.
    await expect(page.getByRole('button', { name: SAVE_DECK })).toHaveCount(0);
    await block.getByRole('button', { name: t('AiChatPage.notes_make_flashcards') }).click();

    // The offer is gone and the existing flashcard block owns the rest.
    await expect(
      block.getByRole('button', { name: t('AiChatPage.notes_make_flashcards') }),
    ).toHaveCount(0);
    const save = page.getByRole('button', { name: SAVE_DECK });
    await expect(save).toBeVisible();
    await expect(save).toContainText('2');

    await save.click();
    await expect(page.getByText(SAVED).first()).toBeVisible();

    // The deck exists and holds the two terms as cards.
    const open = page.getByRole('link', { name: t('AiChatPage.open_deck') });
    await expect(open).toBeVisible();
    const href = await open.getAttribute('href');
    expect(href).toMatch(/\/flashcards\/[0-9a-f-]{36}$/);
    await page.goto(href ?? '');
    await expect(page.getByRole('heading', { name: NOTES.title })).toBeVisible();
    // The page keeps a hidden copy of each card in the DOM; only the visible one counts.
    for (const term of ['Chlorophyll', 'Stroma']) {
      await expect(page.getByText(term, { exact: true }).filter({ visible: true })).toHaveCount(1);
    }
  });
});
