import { writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-22 — Multimedia na fiszce (obraz/audio), `/app/flashcards/<id>`.
 *
 * Case: in the flashcard editor use „Prześlij multimedia” to upload an image and an
 * audio file, then try a disallowed file (.exe / .txt) and a very large file.
 * Expected: the image/audio are inserted into the card content and stay visible after
 * saving and in the study session; a disallowed or too-large file gives a readable
 * error and the editor does not break.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-22 --fresh
 *
 * gives the org `qa-stu-22-<suffix>` with a manager, an educator and the student this
 * case signs in as — every id derived from `tenantKey('qa/cases/STU-22.md',
 * 'STU-22#<suffix>', 'qa-shared')` + `tenantId(key, entity)`. The legacy prerequisite
 * (`student1@dev.local` with a personal deck) maps onto that student, who creates the
 * deck through the product API. Nothing global is read or written: no admin setting,
 * feature flag, plan catalogue, platform stat or singleton row, and no other tenant.
 *
 * Walked on the shared app (:3010): „Nowa Fiszka” opens the editor dialog titled
 * „Utwórz Nową Fiszkę” with the toolbar button „Prześlij multimedia” (hidden
 * `input[type=file]`, accept = png/jpeg/gif/webp + mpeg/wav/ogg). A picked file is
 * uploaded to `POST /api/v1/flashcards/media/upload` and inserted into the *focused*
 * side: an image as `![<file name without extension>](<public url>)`, an audio file as
 * `<audio controls src="<public url>"></audio>`. Saving persists that markdown verbatim
 * (remark keeps the raw HTML node), and both the deck view and the cram session render
 * it through `MarkdownRenderer` (image via the storage public URL, `<audio controls>`).
 *
 * Rejections the product defines (not guessed from the case text):
 * - a type outside the allow-list (`text/plain`, an .exe) → 422 → „Nieobsługiwany
 *   format pliku. Dodaj obraz lub plik audio.”
 * - a file over the 50 MB cap (`MAX_UPLOAD_BYTES`, same value as the `flashcard-media`
 *   bucket `file_size_limit`) → 413 → „Plik jest zbyt duży. Wybierz mniejszy plik.”
 * In both cases the dialog stays open, the content is untouched and the upload button
 * is usable again, so a following valid upload still works.
 */

const CASE = 'STU-22';

const DECKS_URL = '/api/v1/flashcards/decks';
const CARDS_URL = '/api/v1/flashcards';
const UPLOAD_URL = '/api/v1/flashcards/media/upload';

/** Polish copy from `AppFlashcardDeckViewPage` / `FlashcardEditorComponent` / `MediaUpload` (pl.json). */
const COPY = {
  newCard: 'Nowa Fiszka',
  dialogTitle: 'Utwórz Nową Fiszkę',
  create: 'Utwórz',
  cancel: 'Anuluj',
  frontPlaceholder: 'Wprowadź pytanie lub prompt...',
  backPlaceholder: 'Wprowadź odpowiedź lub wyjaśnienie...',
  upload: 'Prześlij multimedia',
  unsupported: 'Nieobsługiwany format pliku. Dodaj obraz lub plik audio.',
  tooLarge: 'Plik jest zbyt duży. Wybierz mniejszy plik.',
  revealHint: 'Kliknij, aby odkryć odpowiedź',
} as const;

const DECK = { name: 'Biologia – multimedia', description: 'Obraz i audio' } as const;
const CARD = {
  front: 'Który obrazek pokazuje komórkę?',
  back: 'Posłuchaj opisu komórki.',
} as const;

/** A 1×1 PNG — a real, loadable image (`naturalWidth === 1` proves the URL is public). */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const IMAGE = {
  name: 'komorka.png',
  mimeType: 'image/png',
  buffer: Buffer.from(PNG_BASE64, 'base64'),
} as const;

/** One MPEG-1 Layer III frame header (`FF FB 90 64`) — sniffs as `audio/mpeg`. */
const AUDIO = {
  name: 'komorka.mp3',
  mimeType: 'audio/mpeg',
  buffer: Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(414)]),
} as const;

const DISALLOWED = [
  { name: 'notatka.txt', mimeType: 'text/plain', buffer: Buffer.from('to nie jest medium') },
  {
    name: 'program.exe',
    mimeType: 'application/x-msdownload',
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]),
  },
] as const;

/** Over `MAX_UPLOAD_BYTES` (50 MB) but under the route's request cap, so the service rejects it. */
const TOO_LARGE = {
  name: 'wielki.png',
  mimeType: 'image/png',
  /** Playwright refuses a >50 MB buffer, so the spec writes this one to disk and passes the path. */
  bytes: (() => {
    const bytes = Buffer.alloc(50 * 1024 * 1024 + 2048);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
    return bytes;
  })(),
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckResponse {
  id: string;
  name: string;
  flashcard_count: number;
}

interface CardResponse {
  id: string;
  front: string;
  back: string;
}

interface ListResponse<T> {
  items: T[];
  total: number;
}

/** Escape a value for use inside a `RegExp`. */
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The sonner toast carrying this text (success and validation share the region). */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** The open flashcard editor dialog, scoped by its title. */
async function cardDialog(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: COPY.dialogTitle })).toBeVisible();
  return dialog;
}

/** Upload through the editor's toolbar input and return the API response. */
async function upload(
  page: Page,
  dialog: Locator,
  file: { name: string; mimeType: string; buffer: Buffer } | { path: string },
): Promise<{ status: number; url?: string }> {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === UPLOAD_URL && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  const input = dialog.locator('input[type="file"]');
  if ('path' in file) {
    await input.setInputFiles(file.path);
  } else {
    await input.setInputFiles(file);
  }
  const response = await pending;
  const body = (await response.json().catch(() => null)) as ApiEnvelope<{ url: string }> | null;
  return { status: response.status(), url: body?.data?.url };
}

// PAUSED (operator, 2026-10-29): the spec is green 5/5 + same-tenant, but it takes ~3.3 min
// under the same-tenant repeat (`--repeat-each=3`) versus ~15 s for its neighbours, which makes
// it the slowest member of the `aut-stu` shard. Skipped until it is revisited; this is a
// deliberate, operator-approved exception to the no-skip admission rule.
test.describe.skip('@case:STU-22 @area:STU @prio:P2 flashcard media', () => {
  test('an uploaded image and audio stay in the card and render in the deck and the study session; rejected files show a readable error', async ({
    page,
  }) => {
    // The oversized-file step moves 50 MB through the browser once; the default 90 s
    // budget is tight on the shared box.
    test.setTimeout(240_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenant.users.student;
    if (!student) throw new Error(`${CASE} needs the content tenant profile (student account)`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // The student's own deck (the legacy „własna talia” prerequisite), created through
    // the product API so the spec never depends on a leftover row of another run.
    const deckResponse = await page.request.post(DECKS_URL, { data: DECK });
    expect(
      deckResponse.status(),
      `POST ${DECKS_URL} → ${deckResponse.status()} ${await deckResponse.text()}`,
    ).toBe(201);
    const deck = ((await deckResponse.json()) as ApiEnvelope<DeckResponse>).data;
    expect(deck.id, 'deck id').toBeTruthy();
    expect(deck.flashcard_count, 'a new deck has no cards').toBe(0);

    await page.goto(`/app/flashcards/${deck.id}`);
    await expect(page).toHaveURL(new RegExp(`/app/flashcards/${deck.id}$`));
    await expect(page.getByRole('heading', { level: 2, name: DECK.name })).toBeVisible();

    // --- Steps 1–2: upload an image and an audio file in the editor ----------
    await page.getByRole('button', { name: COPY.newCard, exact: true }).click();
    const dialog = await cardDialog(page);
    const front = dialog.getByPlaceholder(COPY.frontPlaceholder);
    const back = dialog.getByPlaceholder(COPY.backPlaceholder);
    await expect(dialog.getByRole('button', { name: COPY.upload })).toBeEnabled();

    await front.fill(CARD.front);
    const imageUpload = await upload(page, dialog, IMAGE);
    expect(imageUpload.status, 'the PNG is accepted').toBe(200);
    expect(imageUpload.url, 'the upload answers a public storage URL').toBeTruthy();
    const imageUrl = imageUpload.url!;
    expect(imageUrl, 'the image lands in the flashcard-media bucket').toContain(
      '/storage/v1/object/public/flashcard-media/',
    );

    // The image is inserted into the focused (question) side as markdown…
    await expect(front).toHaveValue(new RegExp(`!\\[komorka\\]\\(${escapeRe(imageUrl)}\\)`));
    await expect.poll(async () => front.inputValue(), { timeout: 10_000 }).toContain(CARD.front);
    // …and the live preview renders it.
    await expect(dialog.locator(`img[src="${imageUrl}"]`)).toBeVisible();

    await back.fill(CARD.back);
    const audioUpload = await upload(page, dialog, AUDIO);
    expect(audioUpload.status, 'the MP3 is accepted').toBe(200);
    const audioUrl = audioUpload.url!;
    await expect
      .poll(async () => back.inputValue(), { timeout: 10_000 })
      .toContain(`<audio controls src="${audioUrl}"></audio>`);
    await expect(dialog.locator(`audio[src="${audioUrl}"]`)).toBeVisible();
    // The audio went to the answer side only.
    expect(await front.inputValue(), 'the question keeps only the image').not.toContain('<audio');

    await dialog.getByRole('button', { name: COPY.create, exact: true }).click();
    await expect(dialog, 'the editor closes after saving').toHaveCount(0);

    // --- Expected result 1a: visible after saving, in the deck view ---------
    // `DeckCard` renders a mobile and a desktop row, so exactly one copy is visible.
    const deckImage = page.locator(`main img[src="${imageUrl}"]:visible`);
    await expect(deckImage, 'the saved card shows the image').toHaveCount(1);
    expect(
      await deckImage.evaluate((element) => (element as HTMLImageElement).naturalWidth),
      'the image really loads from storage',
    ).toBe(1);
    const deckAudio = page.locator(`main audio[src="${audioUrl}"]:visible`);
    await expect(deckAudio, 'the saved card shows the audio player').toHaveCount(1);

    // The content is persisted, not only rendered from the editor state.
    const listResponse = await page.request.get(`${CARDS_URL}?deckIds=${deck.id}&limit=50`);
    expect(listResponse.status(), `GET ${CARDS_URL}?deckIds=…`).toBe(200);
    const cards = ((await listResponse.json()) as ApiEnvelope<ListResponse<CardResponse>>).data
      .items;
    expect(cards, 'the deck holds exactly the card created here').toHaveLength(1);
    expect(cards[0].front, 'stored question keeps the image').toContain(`![komorka](${imageUrl})`);
    expect(cards[0].back, 'stored answer keeps the audio').toContain(
      `<audio controls src="${audioUrl}"></audio>`,
    );

    // A reload serves the card from the API again.
    await page.reload();
    await expect(page.locator(`main img[src="${imageUrl}"]:visible`)).toHaveCount(1);
    await expect(page.locator(`main audio[src="${audioUrl}"]:visible`)).toHaveCount(1);

    // --- Expected result 1b: visible in the study session -------------------
    // Same destination the deck header's practice button pushes (`practiceHref` in
    // `deck-detail-screen.tsx`); the button is icon-only and has no accessible name.
    await page.goto(`/app/study/session/cram?deckId=${deck.id}`);
    await expect(page).toHaveURL(new RegExp(`/app/study/session/cram\\?deckId=${deck.id}$`));

    const flip = page.locator('div[style*="perspective"]').first();
    await expect(flip, 'the session shows the card').toBeVisible();
    const faces = flip.locator('> div > div');
    await expect(faces, 'the card has a question and an answer face').toHaveCount(2);
    const questionFace = faces.nth(0);
    const answerFace = faces.nth(1);

    await expect(
      questionFace.locator(`img[src="${imageUrl}"]`),
      'the question shows the image',
    ).toBeVisible();
    await expect(
      questionFace.locator(`audio[src="${audioUrl}"]`),
      'the answer audio is not on the question face',
    ).toHaveCount(0);
    await expect(
      answerFace.locator(`audio[src="${audioUrl}"]`),
      'the answer face holds the audio player',
    ).toBeVisible();

    await expect(page.getByText(COPY.revealHint, { exact: true })).toBeVisible();
    await flip.click({ position: { x: 20, y: 20 } });
    await expect(page.getByText(COPY.revealHint, { exact: true })).toHaveCount(0);
    await expect(
      answerFace.locator(`audio[src="${audioUrl}"]`),
      'the audio player is still there after revealing the answer',
    ).toBeVisible();

    // --- Step 3: disallowed and too-large files ----------------------------
    await page.goto(`/app/flashcards/${deck.id}`);
    await page.getByRole('button', { name: COPY.newCard, exact: true }).click();
    const rejectDialog = await cardDialog(page);
    const rejectFront = rejectDialog.getByPlaceholder(COPY.frontPlaceholder);
    const uploadButton = rejectDialog.getByRole('button', { name: COPY.upload });
    await rejectFront.fill('Pytanie kontrolne');

    for (const file of DISALLOWED) {
      // Each rejection is its own toast; wait for the previous one to leave the region.
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
      const rejected = await upload(page, rejectDialog, file);
      expect(rejected.status, `${file.name} is rejected by type`).toBe(422);
      await expect(
        toast(page, COPY.unsupported),
        `the readable error for ${file.name}`,
      ).toBeVisible();
      await expect(rejectDialog, 'the editor stays open').toBeVisible();
      await expect(uploadButton, 'the upload button is usable again').toBeEnabled();
      expect(await rejectFront.inputValue(), `${file.name} is not inserted`).toBe(
        'Pytanie kontrolne',
      );
    }

    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    const tooLargePath = test.info().outputPath(TOO_LARGE.name);
    writeFileSync(tooLargePath, TOO_LARGE.bytes);
    const tooLarge = await upload(page, rejectDialog, { path: tooLargePath });
    expect(tooLarge.status, 'a file over the 50 MB cap is rejected').toBe(413);
    await expect(
      toast(page, COPY.tooLarge),
      'the readable error for a too-large file',
    ).toBeVisible();
    await expect(rejectDialog, 'the editor survives the oversized upload').toBeVisible();
    await expect(uploadButton, 'the upload button is usable again').toBeEnabled();
    expect(await rejectFront.inputValue(), 'the oversized file is not inserted').toBe(
      'Pytanie kontrolne',
    );

    // The editor still works after the rejections: a valid upload goes through.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    const recovery = await upload(page, rejectDialog, { ...IMAGE, name: 'po-bledzie.png' });
    expect(recovery.status, 'a valid upload still works after the rejections').toBe(200);
    expect(recovery.url, 'the recovery upload answers a public URL').toBeTruthy();
    await expect(rejectFront).toHaveValue(
      new RegExp(`!\\[po-bledzie\\]\\(${escapeRe(recovery.url!)}\\)`),
    );

    // Nothing was written for the rejected files: the deck still holds one card.
    await rejectDialog.getByRole('button', { name: COPY.cancel, exact: true }).click();
    await expect(rejectDialog).toHaveCount(0);
    const afterResponse = await page.request.get(`${CARDS_URL}?deckIds=${deck.id}&limit=50`);
    const afterCards = ((await afterResponse.json()) as ApiEnvelope<ListResponse<CardResponse>>)
      .data.items;
    expect(afterCards, 'the cancelled editor wrote no card').toHaveLength(1);
    expect(afterCards[0].id, 'the saved card is untouched').toBe(cards[0].id);

    expect(pageErrors, 'uncaught page errors during the media flow').toEqual([]);
  });
});
