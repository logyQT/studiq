import type { Browser, Page } from '@playwright/test';
import {
  expect,
  loadTenant,
  loginAs,
  test,
  type QaRole,
  type QaTenant,
} from '@qa/fixtures/qa-tenant';

/**
 * SEC-11 — Przesyłanie plików: typy i rozmiary.
 *
 * Prerequisite (reconciled with the tenant seeder): an organization on the
 * `hub` plan (so the manager's branding/logo upload is entitled) with a
 * manager, an educator and a student. The legacy manual seed
 * (`manager@dev.local`, `pass`, …) is never used.
 *
 * Tenant: the `content` profile of this case on the `hub` plan
 * (`bun scripts/qa-tenant.ts SEC-11 --fresh` reads `__tests__/qa/profiles/SEC-11.json`),
 * written to `qa/.tenants/SEC-11.json`. Every id comes from the tenant key; no
 * account, org or group id is hard-coded, and nothing global is written.
 *
 * Upload surfaces confirmed during the walk on the shared app:
 * - `POST /api/v1/flashcards/media/upload` — flashcard media (teacher);
 * - `POST /api/v1/organization/<org>/logo` — organization logo (manager, `branding`);
 * - `POST /api/v1/assignments/<id>/upload-image` — answer photo in an assignment
 *   attempt (student).
 *
 * Every surface validates the **bytes**, not the client: the declared MIME type
 * must be allow-listed *and* the first bytes must sniff to that same type
 * (`packages/server/src/services/storage.service.ts`). The spec bypasses the
 * file-picker `accept` attribute, which is why a rejection here is the server's
 * and not the selector's:
 *
 * 1. `.exe`, `.html` and `.svg` (with `<script>`/`onload`) answer 422
 *    `UNPROCESSABLE_ENTITY` with no `data` (no URL is minted).
 * 2. The same payloads relabelled as `image/png` are rejected as well, so the
 *    attacker-controlled `Content-Type`/filename cannot smuggle them in.
 * 3. A real PNG named `evil.html` is accepted, stored with a `.png` extension
 *    and served as `image/png` — the sniffed type decides path, extension and
 *    stored `Content-Type`, so the bytes can never be served as an active
 *    document.
 * 4. Oversize uploads answer 413 `PAYLOAD_TOO_LARGE` at the surface's own cap
 *    (logo 5 MB, answer photo 10 MB) and the logo row keeps its previous value.
 *
 * The CSV import is *not* a file upload: the dialog reads the file as text and
 * posts a JSON card list, so the server-side property is that a binary body is
 * rejected (400) and no deck is created. The AI chat's PDF picker never sends
 * the file (the chat request carries text only, no multipart body), so it has no
 * storage surface to validate.
 */

const CASE = 'SEC-11';
const TENANT: QaTenant = loadTenant(CASE);

/** Run suffix the seeder folded into the tenant key (stable tenants have none). */
const RUN = TENANT.runSuffix ?? 'stable';

const ORG_ID = TENANT.org?.id;
const STUDENT_ID = TENANT.users.student?.id;

/** PNG magic bytes; enough for both a valid control upload and a forged header. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Smallest structurally valid 1×1 PNG the app accepts as a real image. */
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const HTML_PAYLOAD = Buffer.from('<!doctype html><html><script>alert(1)</script></html>');
const SVG_PAYLOAD = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
);
const EXE_PAYLOAD = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);

interface UploadFile {
  label: string;
  name: string;
  mimeType: string;
  bytes: Buffer;
}

/** The files the case asks to try: active/executable formats, plus forged types. */
const ACTIVE_FILES: readonly UploadFile[] = [
  { label: '.exe', name: 'evil.exe', mimeType: 'application/octet-stream', bytes: EXE_PAYLOAD },
  { label: '.html', name: 'evil.html', mimeType: 'text/html', bytes: HTML_PAYLOAD },
  { label: '.svg', name: 'evil.svg', mimeType: 'image/svg+xml', bytes: SVG_PAYLOAD },
  // The client-declared type is attacker-controlled: an active payload that
  // claims to be an image must still be rejected by the byte sniffing.
  { label: 'SVG declared as PNG', name: 'evil.png', mimeType: 'image/png', bytes: SVG_PAYLOAD },
  { label: 'HTML declared as PNG', name: 'evil2.png', mimeType: 'image/png', bytes: HTML_PAYLOAD },
];

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** One signed-in browser context per role, so setup and the assertions share cookies. */
async function signedInPage(
  browser: Browser,
  baseURL: string,
  role: QaRole,
  waitFor: RegExp,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await loginAs(page, TENANT, role, { locale: 'pl', waitFor });
  return { page, close: () => context.close() };
}

function postFile(page: Page, url: string, file: UploadFile, fields: Record<string, string> = {}) {
  return page.request.post(url, {
    multipart: {
      ...fields,
      file: { name: file.name, mimeType: file.mimeType, buffer: file.bytes },
    },
  });
}

/** A rejected upload carries the app error code and — importantly — no URL. */
async function expectRejected(
  response: { status(): number; json(): Promise<unknown> },
  label: string,
) {
  expect(response.status(), `${label} must be rejected server-side`).toBe(422);
  const body = (await response.json()) as ApiEnvelope<{ url?: string; imageUrl?: string }>;
  expect(body.success, `${label} success flag`).toBe(false);
  expect(body.error, `${label} error code`).toBe('UNPROCESSABLE_ENTITY');
  expect(body.data, `${label} must not mint a storage URL`).toBeUndefined();
}

async function expectTooLarge(
  response: { status(): number; json(): Promise<unknown> },
  label: string,
) {
  expect(response.status(), `${label} must exceed the surface cap`).toBe(413);
  const body = (await response.json()) as ApiEnvelope<unknown>;
  expect(body.success, `${label} success flag`).toBe(false);
  expect(body.error, `${label} error code`).toBe('PAYLOAD_TOO_LARGE');
}

/** Assert the public object is served as an inert image, never as a document. */
async function expectInertImage(page: Page, url: string, label: string): Promise<void> {
  expect(url, `${label} is stored as a sniffed .png object`).toMatch(/\.png$/);
  const stored = await page.request.get(url);
  expect(stored.status(), `GET ${label} stored object`).toBe(200);
  const contentType = stored.headers()['content-type'] ?? '';
  expect(contentType, `${label} stored Content-Type`).toMatch(/^image\/png/);
  expect(contentType, `${label} is never served as an active document`).not.toMatch(
    /text\/html|image\/svg/,
  );
  const bytes = await stored.body();
  expect(bytes.subarray(0, PNG_SIGNATURE.length), `${label} stored bytes`).toEqual(PNG_SIGNATURE);
}

/** Flashcard media: 422 for every active payload, accepted controls stay inert images. */
async function expectFlashcardMediaRules(page: Page): Promise<void> {
  const url = '/api/v1/flashcards/media/upload';

  for (const file of ACTIVE_FILES) {
    await expectRejected(await postFile(page, url, file), `POST ${url} (${file.label})`);
  }

  // A genuine image keeps working, whatever the attacker-controlled name says:
  // extension and stored Content-Type come from the sniffed bytes.
  const disguised = await postFile(page, url, {
    label: 'PNG named .html',
    name: 'evil.html',
    mimeType: 'image/png',
    bytes: VALID_PNG,
  });
  expect(
    disguised.status(),
    'POST /api/v1/flashcards/media/upload (real PNG named evil.html)',
  ).toBe(200);
  const body = (await disguised.json()) as ApiEnvelope<{ url: string }>;
  expect(body.success).toBe(true);
  await expectInertImage(page, body.data!.url, 'flashcard media');

  // The media cap is 50 MB (`MAX_UPLOAD_BYTES`), so a >20 MB file is inside the
  // documented limit and deliberately not asserted as a rejection here; the
  // logo (5 MB) and answer-photo (10 MB) caps below cover the size dimension.
}

/** Organization logo: manager upload, 5 MB cap, and the row is never touched on failure. */
async function expectOrganizationLogoRules(page: Page): Promise<void> {
  const url = `/api/v1/organization/${ORG_ID}/logo`;
  const detailUrl = `/api/v1/organization/${ORG_ID}`;

  const before = await page.request.get(detailUrl);
  expect(before.status(), `GET ${detailUrl}`).toBe(200);
  const previousLogo = ((await before.json()) as ApiEnvelope<{ logo_url: string | null }>).data
    ?.logo_url;

  for (const file of ACTIVE_FILES) {
    await expectRejected(await postFile(page, url, file), `POST ${url} (${file.label})`);
  }

  // > 20 MB is far above the 5 MB org-logos bucket cap.
  const oversize = Buffer.alloc(21 * 1024 * 1024);
  PNG_SIGNATURE.copy(oversize);
  await expectTooLarge(
    await postFile(page, url, {
      label: '21 MB PNG',
      name: 'big.png',
      mimeType: 'image/png',
      bytes: oversize,
    }),
    `POST ${url} (21 MB)`,
  );

  const afterRejections = await page.request.get(detailUrl);
  const logoAfterRejections = (
    (await afterRejections.json()) as ApiEnvelope<{ logo_url: string | null }>
  ).data?.logo_url;
  expect(logoAfterRejections, 'rejected uploads must not change the organization logo').toBe(
    previousLogo,
  );

  const accepted = await postFile(page, url, {
    label: 'valid PNG',
    name: 'logo.png',
    mimeType: 'image/png',
    bytes: VALID_PNG,
  });
  expect(accepted.status(), `POST ${url} (valid PNG)`).toBe(200);
  const logoUrl = ((await accepted.json()) as ApiEnvelope<{ logo_url: string }>).data?.logo_url;
  expect(logoUrl, 'accepted logo URL').toContain(`/org-logos/${ORG_ID}/`);
  await expectInertImage(page, logoUrl!, 'organization logo');
}

interface AssignmentSetup {
  id: string;
  attemptId: string;
  questionId: string;
}

/** Build a published assignment for the tenant's student and start their attempt. */
async function createAssignmentAttempt(teacher: Page, student: Page): Promise<AssignmentSetup> {
  const suffix = `${RUN}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const bank = await teacher.request.post('/api/v1/questions/banks', {
    data: { name: `SEC-11 bank ${suffix}` },
  });
  expect(bank.status(), `POST /api/v1/questions/banks → ${await bank.text()}`).toBe(201);
  const bankId = ((await bank.json()) as ApiEnvelope<{ id: string }>).data!.id;

  const question = await teacher.request.post('/api/v1/questions', {
    data: { bankId, content: `SEC-11 answer photo ${suffix}`, type: 'open' },
  });
  expect(question.status(), `POST /api/v1/questions → ${await question.text()}`).toBe(201);
  const questionId = ((await question.json()) as ApiEnvelope<{ id: string }>).data!.id;

  const assignment = await teacher.request.post('/api/v1/teacher/assignments', {
    data: { title: `SEC-11 kartkówka ${suffix}` },
  });
  expect(assignment.status(), `POST /api/v1/teacher/assignments → ${await assignment.text()}`).toBe(
    201,
  );
  const id = ((await assignment.json()) as ApiEnvelope<{ id: string }>).data!.id;

  const added = await teacher.request.post(`/api/v1/teacher/assignments/${id}/questions`, {
    data: { questionIds: [questionId] },
  });
  expect(added.status(), `POST /api/v1/teacher/assignments/${id}/questions`).toBe(200);

  const targeted = await teacher.request.put(`/api/v1/teacher/assignments/${id}/targets`, {
    data: { studentIds: [STUDENT_ID] },
  });
  expect(targeted.status(), `PUT /api/v1/teacher/assignments/${id}/targets`).toBe(200);

  const published = await teacher.request.post(`/api/v1/teacher/assignments/${id}/publish`, {
    data: {},
  });
  expect(published.status(), `POST /api/v1/teacher/assignments/${id}/publish`).toBe(200);

  const started = await student.request.post(`/api/v1/assignments/${id}/start`);
  expect(started.status(), `POST /api/v1/assignments/${id}/start`).toBe(200);
  const attemptId = ((await started.json()) as ApiEnvelope<{ id: string }>).data!.id;

  return { id, attemptId, questionId };
}

/** Answer photo („zdjęcia kartkówki”): same byte validation, 10 MB cap. */
async function expectAnswerPhotoRules(teacher: Page, student: Page): Promise<AssignmentSetup> {
  const setup = await createAssignmentAttempt(teacher, student);
  const url = `/api/v1/assignments/${setup.id}/upload-image`;
  const fields = { attemptId: setup.attemptId, questionId: setup.questionId };

  for (const file of ACTIVE_FILES) {
    await expectRejected(await postFile(student, url, file, fields), `POST ${url} (${file.label})`);
  }

  const oversize = Buffer.alloc(11 * 1024 * 1024);
  PNG_SIGNATURE.copy(oversize);
  await expectTooLarge(
    await postFile(
      student,
      url,
      { label: '11 MB PNG', name: 'big.png', mimeType: 'image/png', bytes: oversize },
      fields,
    ),
    `POST ${url} (11 MB)`,
  );

  const accepted = await postFile(
    student,
    url,
    { label: 'valid PNG', name: 'answer.png', mimeType: 'image/png', bytes: VALID_PNG },
    fields,
  );
  expect(accepted.status(), `POST ${url} (valid PNG)`).toBe(200);
  const imageUrl = ((await accepted.json()) as ApiEnvelope<{ imageUrl: string }>).data?.imageUrl;
  await expectInertImage(student, imageUrl!, 'answer photo');

  return setup;
}

/** CSV import is JSON, not a file upload: a binary body is rejected and no deck appears. */
async function expectCsvImportRejectsBinary(page: Page): Promise<void> {
  const decksBefore = await page.request.get('/api/v1/flashcards/decks?limit=200');
  expect(decksBefore.status(), 'GET /api/v1/flashcards/decks').toBe(200);
  const beforeIds = (
    (await decksBefore.json()) as ApiEnvelope<{ items: Array<{ id: string }> }>
  ).data!.items.map((deck) => deck.id);

  const response = await page.request.post('/api/v1/flashcards/import/csv', {
    headers: { 'content-type': 'text/csv' },
    data: EXE_PAYLOAD,
  });
  expect(response.status(), 'POST /api/v1/flashcards/import/csv (binary body)').toBe(400);
  const body = (await response.json()) as ApiEnvelope<unknown>;
  expect(body.success).toBe(false);

  const decksAfter = await page.request.get('/api/v1/flashcards/decks?limit=200');
  const afterIds = (
    (await decksAfter.json()) as ApiEnvelope<{ items: Array<{ id: string }> }>
  ).data!.items.map((deck) => deck.id);
  expect(afterIds, 'a rejected CSV payload must not create a deck').toEqual(beforeIds);
}

test.describe('@case:SEC-11 @area:SEC @prio:P2 upload type and size validation', () => {
  test('rejects active file types and oversize uploads at every server upload surface', async ({
    browser,
    baseURL,
  }) => {
    expect(ORG_ID, `${CASE} needs the content tenant profile with an organization`).toBeTruthy();
    expect(STUDENT_ID, `${CASE} needs the seeded student`).toBeTruthy();
    console.log(`SEC-11 tenant key: ${TENANT.key}`);
    console.log(`SEC-11 org: ${ORG_ID} (${TENANT.org?.name}) plan ${TENANT.plan}`);

    const appUrl = baseURL ?? 'http://localhost:3010';
    const manager = await signedInPage(browser, appUrl, 'manager', /\/manage/);
    const teacher = await signedInPage(browser, appUrl, 'teacher', /\/edu/);
    const student = await signedInPage(browser, appUrl, 'student', /\/app/);

    try {
      await expectFlashcardMediaRules(teacher.page);
      await expectOrganizationLogoRules(manager.page);
      await expectAnswerPhotoRules(teacher.page, student.page);
      await expectCsvImportRejectsBinary(teacher.page);
    } finally {
      await Promise.all([manager.close(), teacher.close(), student.close()]);
    }
  });
});
