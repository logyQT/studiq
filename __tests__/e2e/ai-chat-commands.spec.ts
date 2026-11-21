import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { signIn } from '#test/e2e/fixtures/tenant';
import { mockAiChatEntitled, t } from '#test/e2e/utils';

/**
 * Slash commands of the AI chat (#1150): the menu the composer opens on `/`, and what a sent
 * command looks like on the wire and in the transcript. The model is not involved: the chat
 * endpoint is answered by the spec, and the instruction the model receives is covered by
 * `__tests__/integration/ai-chat-command.test.ts`.
 */

const COMMAND = '/explain photosynthesis';

/** Answers the chat endpoint with a one-line reply and records the request bodies it saw. */
async function stubChat(page: Page): Promise<unknown[]> {
  const bodies: unknown[] = [];
  const frames = [
    { type: 'start' },
    { type: 'start-step' },
    { type: 'text-start', id: 'txt-0' },
    { type: 'text-delta', id: 'txt-0', delta: 'A stubbed answer.' },
    { type: 'text-end', id: 'txt-0' },
    { type: 'finish-step' },
    { type: 'finish', finishReason: 'stop' },
  ];
  await page.route('**/api/v1/ai/chat', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-vercel-ai-ui-message-stream': 'v1',
        'cache-control': 'no-cache',
      },
      body: [
        ...frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`),
        'data: [DONE]\n\n',
      ].join(''),
    });
  });
  return bodies;
}

async function openChat(page: Page) {
  await mockAiChatEntitled(page);
  await signIn(page, 'student');
  await page.goto('/app/ai');
  const input = page.getByPlaceholder(t('AiChatPage.input_placeholder'));
  await expect(input).toBeVisible();
  return input;
}

const menu = (page: Page) => page.getByRole('listbox');
const explainOption = (page: Page) => page.getByRole('option', { name: /\/explain/ });

test.describe('AI chat slash commands (#1150)', () => {
  test('a slash opens the menu, filters it as the name is typed and closes on Escape', async ({
    page,
  }) => {
    const input = await openChat(page);
    await expect(menu(page)).toHaveCount(0);

    await input.fill('/');
    await expect(explainOption(page)).toBeVisible();
    // The option carries its hint and its description, in the UI language.
    await expect(explainOption(page)).toContainText(t('AiChatPage.command_explain_hint'));
    await expect(explainOption(page)).toContainText(t('AiChatPage.command_explain_description'));

    await input.fill('/ex');
    await expect(explainOption(page)).toBeVisible();

    await input.fill('/zzz');
    await expect(menu(page)).toHaveCount(0);

    // Escape closes it for the text typed so far; typing again brings it back.
    await input.fill('/ex');
    await expect(explainOption(page)).toBeVisible();
    await input.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await input.pressSequentially('p');
    await expect(explainOption(page)).toBeVisible();
  });

  test('does not open for a slash in the middle of a message', async ({ page }) => {
    const input = await openChat(page);

    await input.fill('what is 1/2 of 10');
    await expect(menu(page)).toHaveCount(0);
    await input.fill('please /ex');
    await expect(menu(page)).toHaveCount(0);
  });

  test('Tab and Enter pick the highlighted command instead of sending, keeping the focus', async ({
    page,
  }) => {
    const bodies = await stubChat(page).then(async (seen) => {
      await openChat(page);
      return seen;
    });
    const input = page.getByPlaceholder(t('AiChatPage.input_placeholder'));

    await input.fill('/');
    await expect(explainOption(page)).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Tab');
    await expect(input).toHaveValue('/explain ');
    await expect(menu(page)).toHaveCount(0);
    await expect(input).toBeFocused();

    await input.fill('/ex');
    await input.press('Enter');
    await expect(input).toHaveValue('/explain ');
    expect(bodies).toHaveLength(0);
  });

  test('a click picks a command and leaves the caret in the text field', async ({ page }) => {
    const input = await openChat(page);

    await input.fill('/');
    await explainOption(page).click();
    await expect(input).toHaveValue('/explain ');
    await expect(input).toBeFocused();
  });

  test('an input method confirming a candidate with Enter neither picks nor sends', async ({
    page,
  }) => {
    const bodies = await stubChat(page).then(async (seen) => {
      await openChat(page);
      return seen;
    });
    const input = page.getByPlaceholder(t('AiChatPage.input_placeholder'));

    await input.fill('/ex');
    await expect(explainOption(page)).toBeVisible();

    // keydown is dispatched, not pressed: a pressed Enter outside a real composition would
    // insert a line break, which is not what the browser does while an input method is open.
    const enter = { key: 'Enter', bubbles: true };

    // While a composition is open (the browsers that report it as events) ...
    await input.dispatchEvent('compositionstart');
    await input.dispatchEvent('keydown', enter);
    await expect(input).toHaveValue('/ex');
    await input.dispatchEvent('compositionend');

    // ... and on the keydown the browser itself flags as part of a composition.
    await input.dispatchEvent('keydown', { ...enter, isComposing: true });
    await expect(input).toHaveValue('/ex');
    expect(bodies).toHaveLength(0);

    // Outside a composition, the same key picks the command.
    await input.press('Enter');
    await expect(input).toHaveValue('/explain ');
  });

  test('a sent command goes to the server as typed, and the transcript shows it as typed', async ({
    page,
  }) => {
    const bodies = await stubChat(page).then(async (seen) => {
      await openChat(page);
      return seen;
    });
    const input = page.getByPlaceholder(t('AiChatPage.input_placeholder'));

    await input.fill(COMMAND);
    // The command is complete (a space follows its name), so Enter sends it.
    await input.press('Enter');

    await expect(page.getByText('A stubbed answer.')).toBeVisible();
    await expect(page.getByText(COMMAND, { exact: true })).toBeVisible();
    // The instruction the model gets is the server's business and never reaches the transcript.
    await expect(page.getByText(/one-sentence definition/)).toHaveCount(0);

    expect(bodies).toHaveLength(1);
    const sent = JSON.stringify(bodies[0]);
    expect(sent).toContain(COMMAND);
    expect(sent).not.toContain('one-sentence definition');
  });
});
