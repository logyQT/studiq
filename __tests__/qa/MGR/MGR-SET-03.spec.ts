import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * MGR-SET-03 — logo rejects disallowed files and oversized images.
 *
 * Case step: "Spróbuj wgrać plik .txt, plik .svg i obraz > 5 MB."
 * Expected: the selector accepts PNG, JPEG, GIF and WEBP only; a disallowed or
 * oversized file shows the toast „Nie udało się zapisać” and leaves the logo
 * unchanged.
 *
 * Tenant (deterministic, one per independent run):
 *
 *   bun scripts/qa-tenant.ts MGR-SET-03 --fresh
 *
 * `__tests__/qa/profiles/<CASE>.json` declares `{ profile: "content", plan: "hub" }`: the
 * `content` tenant supplies the org's manager and `--plan hub` puts *this
 * tenant's own* organization on Hub through `apply_org_plan`, which is the
 * case's prerequisite („Plan z brandingiem”). Nothing global is written — no
 * admin setting, feature flag, plan catalogue row or singleton.
 *
 * The spec first uploads a real PNG through the same hidden file input the page
 * uses, so "does not change the logo" is asserted against a logo that exists
 * (a rejected upload that cleared `logo_url` would be caught, not masked by an
 * empty state). The three rejected uploads then come from the case.
 */

const CASE = 'MGR-SET-03';

/** Polish copy from `ManageSettingsPage` (`apps/web/src/i18n/messages/pl.json`). */
const COPY = {
  title: 'Ustawienia',
  logoLabel: 'Logo',
  noLogo: 'Brak logo',
  uploadLogo: 'Wgraj logo',
  logoUpdated: 'Logo zaktualizowane',
  saveFailed: 'Nie udało się zapisać',
} as const;

/** The `<input accept>` list the page renders: PNG, JPEG, GIF, WEBP. */
const ALLOWED_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

/** A real 1×1 PNG — `storageService` sniffs the bytes, not the file name. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The three files the case uploads, each with the API error the UI turns into a toast. */
const REJECTED_FILES = [
  {
    label: '.txt (text/plain)',
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
    status: 422,
  },
  {
    label: '.svg (image/svg+xml)',
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
    ),
    status: 422,
  },
  {
    label: '> 5 MB PNG',
    name: 'too-big.png',
    mimeType: 'image/png',
    buffer: (() => {
      const bytes = Buffer.alloc(6 * 1024 * 1024);
      // 5 MB is the org-logos bucket cap; the size check fires before sniffing.
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
      return bytes;
    })(),
    status: 413,
  },
] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface OrganizationDetail {
  id: string;
  name: string;
  logo_url: string | null;
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const res = await page.request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success`).toBe(true);
  return body.data;
}

/** The logo currently persisted on the org (the page reads the same row). */
async function logoUrl(page: Page, orgId: string): Promise<string | null> {
  const org = await getJson<OrganizationDetail>(page, `/api/v1/organization/${orgId}`);
  return org.logo_url;
}

function toasts(page: Page) {
  return page.locator('[data-sonner-toast]');
}

/**
 * Sonner keeps a toast for 4 s (`duration={4000}` in `app/layout.tsx`). Letting
 * it clear means the next assertion can only see a toast from the next upload —
 * a stale „Nie udało się zapisać” can never make a silently accepted file pass.
 */
async function waitForToastsToClear(page: Page): Promise<void> {
  await expect(toasts(page)).toHaveCount(0, { timeout: 15_000 });
}

test('rejects .txt, .svg and an oversized image without changing the logo', async ({ page }) => {
  test.setTimeout(120_000);

  const tenant = loadTenant(CASE);
  expect(tenant.org, `${CASE} needs the seeded organization`).toBeTruthy();
  // The case prerequisite is a plan that includes branding; the tenant seeder
  // applies it to this org only, so no global plan row is touched.
  expect(tenant.plan, `${CASE} needs its tenant org on Hub`).toBe('hub');

  const orgId = tenant.org!.id;
  const orgName = tenant.org!.name;

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

  const features = await getJson<{ features: string[] }>(page, '/api/v1/features/me');
  expect(features.features, 'the org plan unlocks branding').toContain('branding');

  await page.goto('/manage/settings');
  await expect(page.getByRole('heading', { name: COPY.title, level: 2 })).toBeVisible();
  await expect(page.getByText(COPY.logoLabel, { exact: true })).toBeVisible();

  // --- Acceptance: the picker offers exactly PNG, JPEG, GIF and WEBP ---------
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toHaveAttribute('accept', ALLOWED_ACCEPT);
  await expect(page.getByRole('button', { name: COPY.uploadLogo })).toBeVisible();

  // --- Adjacent positive path: a valid PNG becomes the logo ------------------
  const initialLogo = await logoUrl(page, orgId);
  await fileInput.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(toasts(page).filter({ hasText: COPY.logoUpdated })).toBeVisible({ timeout: 20_000 });

  const uploadedLogo = await logoUrl(page, orgId);
  expect(uploadedLogo, 'a valid PNG is stored as the org logo').toBeTruthy();
  expect(uploadedLogo, 'a valid PNG replaces the previous logo').not.toBe(initialLogo);

  const preview = page.locator(`img[alt="${orgName}"]`);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', uploadedLogo!);
  await expect(preview).toHaveAttribute('width', '48');
  await expect(preview).toHaveAttribute('height', '48');
  await expect(page.getByText(COPY.noLogo, { exact: true })).toHaveCount(0);

  await waitForToastsToClear(page);

  // --- Step 1: each rejected file shows the toast and keeps the logo ---------
  for (const file of REJECTED_FILES) {
    // Pin the server-side reason as well as the toast: type only allow-lists
    // PNG/JPEG/GIF/WEBP (422), the org-logos bucket caps at 5 MB (413).
    const response = await page.request.post(`/api/v1/organization/${orgId}/logo`, {
      multipart: { file: { name: file.name, mimeType: file.mimeType, buffer: file.buffer } },
    });
    expect(response.status(), `POST logo with ${file.label}`).toBe(file.status);

    await fileInput.setInputFiles({
      name: file.name,
      mimeType: file.mimeType,
      buffer: file.buffer,
    });
    await expect(
      toasts(page).filter({ hasText: COPY.saveFailed }),
      `${file.label} shows „${COPY.saveFailed}”`,
    ).toBeVisible({ timeout: 20_000 });

    // The upload button leaves its pending state only after the request settled.
    await expect(page.getByRole('button', { name: COPY.uploadLogo })).toBeVisible();
    expect(await logoUrl(page, orgId), `${file.label} keeps the stored logo`).toBe(uploadedLogo);
    await expect(preview, `${file.label} keeps the 48×48 preview`).toHaveAttribute(
      'src',
      uploadedLogo!,
    );
    await expect(page.getByText(COPY.noLogo, { exact: true })).toHaveCount(0);

    await waitForToastsToClear(page);
  }

  // --- The valid logo survives a reload, untouched by the rejected uploads ---
  await page.reload();
  await expect(page.getByRole('heading', { name: COPY.title, level: 2 })).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', uploadedLogo!);
  expect(await logoUrl(page, orgId)).toBe(uploadedLogo);

  expect(pageErrors, 'no uncaught page errors').toEqual([]);
});
