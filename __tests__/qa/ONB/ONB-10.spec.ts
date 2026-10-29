import { expect, type Page } from '@playwright/test';
import { loadTenant, loginAs, test, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * ONB-10 — the organization member limit is enforced when an invitation is
 * accepted, and the counter includes every member (admin, teachers, members).
 *
 * The tenant sits one seat below its plan capacity
 * (`bun scripts/qa-tenant.ts ONB-10 --profile org-limit --fresh`): a Launch org
 * with four members — admin, two teachers and one member — plus two invitee
 * accounts that are **not** org members. The manager sends both invitations in
 * `/manage/invites`; each invitee accepts the code through `/app/join`, the
 * signed-in "join" surface the org switcher offers.
 *
 * Expected (case text): the first acceptance fills the last free seat (5 of 5),
 * the second one is refused with `USAGE_LIMIT_EXCEEDED` (HTTP 429) and a
 * member-limit message, and the second invitee never becomes an org member.
 *
 * Every id comes from the tenant fixture (`tenantKey`/`tenantId`); no global
 * admin setting, feature flag, plan row or singleton is written, and the spec
 * only ever reads its own tenant's org and users.
 */

const CASE = 'ONB-10';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

async function getJson<T>(page: Page, url: string): Promise<ApiEnvelope<T>> {
  const res = await page.request.get(url);
  const body = (await res.json()) as ApiEnvelope<T>;
  expect(res.ok(), `GET ${url} → ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  return body;
}

/** One invitation row on `/manage/invites`: e-mail field + role combobox. */
async function fillInviteRow(
  page: Page,
  index: number,
  email: string,
  roleLabel: string,
): Promise<void> {
  await page.locator(`#email-${index}`).fill(email);
  await page.locator(`#role-${index}`).click();
  await page.getByRole('option', { name: roleLabel, exact: true }).click();
  await expect(page.locator(`#role-${index}`)).toHaveText(roleLabel);
}

/** The 32-hex invite code the manager page shows for each result row. */
function inviteCodeFor(rows: string[], email: string): string {
  const row = rows.find((text) => text.includes(email));
  expect(row, `no invitation result row for ${email}`).toBeTruthy();
  const code = row?.match(/[0-9a-f]{32}/)?.[0];
  expect(code, `no invite code in the result row "${row}"`).toMatch(/^[0-9a-f]{32}$/);
  return code as string;
}

/** Accept an invitation through `/app/join` and return the accept response. */
async function acceptInvite(page: Page, token: string) {
  await page.goto('/app/join');
  await page.locator('#token').fill(token);
  const response = page.waitForResponse(
    (res) =>
      res.url().includes('/api/v1/organization/invites/accept') &&
      res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Join' }).click();
  return response;
}

test.describe('ONB-10 — organization member limit at invitation acceptance', () => {
  test('the first invitation takes the last seat, the second is refused with a limit error', async ({
    page,
    context,
  }) => {
    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, 'ONB-10 needs the org-limit tenant profile').toBe('org-limit');
    if (!tenant.org || !tenant.users.invitee1 || !tenant.users.invitee2) {
      throw new Error(
        'ONB-10 fixture incomplete: run `bun scripts/qa-tenant.ts ONB-10 --profile org-limit --fresh`',
      );
    }
    const org = tenant.org;
    const invitee1 = tenant.users.invitee1;
    const invitee2 = tenant.users.invitee2;

    // --- Step 1: the manager invites two new addresses (member role) --------
    await loginAs(page, tenant, 'manager', { waitFor: /\/manage/ });

    const plan = await getJson<{ key: string; limits: Record<string, number> }>(
      page,
      '/api/v1/me/plan',
    );
    const capacity = plan.data.limits.max_students;
    expect(capacity, 'ONB-10 needs a finite organization capacity').toBeGreaterThan(0);

    const membersBefore = await getJson<Array<{ email: string; orgRoleName: string }>>(
      page,
      '/api/v1/organization/members',
    );
    // The prerequisite: the org is exactly one seat below its plan capacity, so
    // the next accept fills it and the one after has to be refused.
    expect(
      membersBefore.data,
      `ONB-10 fixture must sit at capacity - 1 (org plan ${plan.data.key}, capacity ${capacity})`,
    ).toHaveLength(capacity - 1);
    // The counter is org-wide: the seeded seats are admin + two teachers + member.
    expect(new Set(membersBefore.data.map((member) => member.orgRoleName))).toEqual(
      new Set(['admin', 'teacher', 'member']),
    );

    const roles = await getJson<Array<{ id: string; name: string; displayName?: string }>>(
      page,
      '/api/v1/organization/roles',
    );
    const memberRole = roles.data.find((role) => role.name === 'member');
    expect(memberRole, 'the org has no "member" role').toBeTruthy();
    const memberRoleLabel = memberRole?.displayName ?? memberRole?.name ?? '';

    const rolesLoaded = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/organization/roles') && res.status() === 200,
    );
    await page.goto('/manage/invites');
    await rolesLoaded;

    await fillInviteRow(page, 0, invitee1.email, memberRoleLabel);
    await page.getByRole('button', { name: 'Add another' }).click();
    await fillInviteRow(page, 1, invitee2.email, memberRoleLabel);

    const bulkResponse = page.waitForResponse(
      (res) =>
        res.url().endsWith('/api/v1/organization/invites/bulk') &&
        res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Send invitations' }).click();
    const bulk = await bulkResponse;
    expect(bulk.status(), `bulk invite failed: ${await bulk.text()}`).toBeLessThan(300);

    await expect(page.getByTestId('invite-result-row')).toHaveCount(2);
    const resultRows = await page.getByTestId('invite-result-row').allInnerTexts();
    const token1 = inviteCodeFor(resultRows, invitee1.email);
    const token2 = inviteCodeFor(resultRows, invitee2.email);

    // --- Step 2: the first invitee accepts — the last free seat is used -----
    await context.clearCookies();
    await loginAs(page, tenant, 'invitee1', { activeOrgId: null });

    const accept1 = await acceptInvite(page, token1);
    expect(accept1.status(), 'the first acceptance must succeed').toBe(200);
    const accept1Body = (await accept1.json()) as ApiEnvelope<{ id: string }>;
    expect(accept1Body.success, JSON.stringify(accept1Body)).toBe(true);
    expect(accept1Body.data.id).toBe(org.id);

    // The UI consumed the code and the invitee now belongs to the org.
    await expect(page.locator('#token')).toHaveValue('');
    const orgs1 = await getJson<Array<{ id: string; orgRoleName: string }>>(
      page,
      '/api/v1/me/orgs',
    );
    expect(orgs1.data, 'the first invitee is now a member of the tenant org').toHaveLength(1);
    expect(orgs1.data[0].id).toBe(org.id);
    expect(orgs1.data[0].orgRoleName).toBe('member');

    // --- Step 3: the second invitee is refused — the org is at capacity -----
    await context.clearCookies();
    await loginAs(page, tenant, 'invitee2', { activeOrgId: null });
    const orgs2Before = await getJson<Array<unknown>>(page, '/api/v1/me/orgs');
    expect(orgs2Before.data, 'the second invitee starts outside the org').toHaveLength(0);

    const accept2 = await acceptInvite(page, token2);
    expect(accept2.status(), 'the second acceptance must be refused by the plan limit').toBe(429);
    const accept2Body = (await accept2.json()) as ApiEnvelope<unknown>;
    expect(accept2Body.success).toBe(false);
    expect(accept2Body.error).toBe('USAGE_LIMIT_EXCEEDED');

    // The refusal is explained next to the field and the code is not consumed.
    const limitMessage = page.locator('#token-error');
    await expect(limitMessage).toBeVisible();
    await expect(limitMessage).toHaveText(/member limit/i);
    await expect(page.locator('#token')).toHaveValue(token2);
    await expect(page.locator('#token')).toHaveAttribute('aria-invalid', 'true');

    const orgs2After = await getJson<Array<unknown>>(page, '/api/v1/me/orgs');
    expect(orgs2After.data, 'the refused invitee must not be added to org_members').toHaveLength(0);
    // The invitation itself is still live: only the seat limit refused it.
    const preview = await getJson<{ email: string }>(
      page,
      `/api/v1/organization/invites?token=${token2}`,
    );
    expect(preview.data.email).toBe(invitee2.email);

    // --- 5 of 5: the org is now full, with exactly the first invitee --------
    await context.clearCookies();
    await loginAs(page, tenant, 'manager', { waitFor: /\/manage/ });
    const membersAfter = await getJson<Array<{ email: string; orgRoleName: string }>>(
      page,
      '/api/v1/organization/members',
    );
    expect(
      membersAfter.data,
      `the org is now at capacity (${capacity} of ${capacity})`,
    ).toHaveLength(capacity);
    const emailsAfter = membersAfter.data.map((member) => member.email);
    expect(emailsAfter, 'the first invitee joined').toContain(invitee1.email);
    expect(emailsAfter, 'the refused invitee did not join').not.toContain(invitee2.email);
    expect(membersAfter.data.find((member) => member.email === invitee1.email)?.orgRoleName).toBe(
      'member',
    );
  });
});
