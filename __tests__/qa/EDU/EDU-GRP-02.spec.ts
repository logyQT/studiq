import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-GRP-02 — managing a group's members from the educator panel (`/edu/groups`).
 *
 * Case steps: click „Zarządzaj członkami”, then pick people in „Wybierz osoby…”
 * and save.
 *
 * Tenant (deterministic, one per run):
 *
 *   bun scripts/qa-tenant.ts EDU-GRP-02 --fresh
 *
 * The legacy seed names its people M1/S1/T1 and group `O1G1`. Automation uses
 * the case's own tenant instead: the `org-limit` profile is the seeded shape that
 * holds an educator with the real org `teacher` role — the entitlement that
 * carries `group.manage` (EDU-GRP-01's „T1, plan Lite”) — plus `users.student`,
 * a second teacher, and two `invitee` accounts that exist but are **not** org
 * members. Those invitees are the control for „Dostępni są wyłącznie członkowie
 * tej organizacji”: the roster picker must never offer them.
 *
 * The tenant seeder's default group `G1` belongs to the manager, so the educator
 * cannot manage it — the case's group is created by the educator through the
 * product API (the EDU-GRP-01 prerequisite), which makes `canManage` true and
 * gives the spec a group whose roster it fully owns. The same roster endpoint
 * `/manage/groups` and `/edu/groups` use resets that group to an empty roster, so
 * every run starts from the „Wybierz osoby…” state instead of depending on a
 * previous run (CI seeds one tenant and retries against it).
 *
 * The case's last acceptance point — the added student sees content shared to the
 * group — needs a deck shared to the group, and only a group `teacher` may share
 * one. The spec shares it while the educator is briefly the group's teacher, then
 * clears the roster again so the member step still starts from the empty
 * EDU-GRP-01 group: the student is outside the group (deck invisible) right up to
 * the save, and sees the deck the moment they are added.
 *
 * Nothing global (admin settings, feature flags, plans, platform stats, singleton
 * rows) is read or written; every id comes from the tenant fixture.
 */

const CASE = 'EDU-GRP-02';

/** Polish copy from `ManageGroupsPage` (`apps/web/src/i18n/messages/pl.json`). */
const COPY = {
  title: 'Grupy',
  nameColumn: 'Nazwa',
  membersColumn: 'Członkowie',
  teachersColumn: 'Nauczyciele',
  actionsColumn: 'Akcje',
  manageMembers: 'Zarządzaj członkami',
  manageMembersDesc: 'Wybierz, kto należy do tej grupy.',
  membersLabel: 'Członkowie',
  membersPlaceholder: 'Wybierz osoby...',
  memberRoles: 'Role w grupie',
  roleTeacher: 'Nauczyciel',
  roleMember: 'Członek',
  save: 'Zapisz',
  membersUpdated: 'Skład grupy zaktualizowany',
} as const;

/** The EDU-GRP-01 group this case manages. */
const GROUP_NAME = 'Grupa testowa';
const GROUP_DESCRIPTION = 'Grupa z EDU-GRP-01';

/** Content shared to that group — what the added student must end up seeing. */
const DECK_NAME = 'EDU-GRP-02 treści grupowe';

const GROUPS_URL = '/api/v1/organization/groups';
const DECKS_URL = '/api/v1/flashcards/decks';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  memberCount: number;
  teacherCount: number;
  canManage: boolean;
}

interface OrgMember {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
}

/** Row shape of `GET /api/v1/organization/groups/:id/addable-members`. */
interface AddableMember {
  id: string;
  email: string;
  fullName: string | null;
  orgRoleName: string;
}

/** Row shape of `GET /api/v1/organization/groups/:id/members`. */
interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

interface DeckListItem {
  id: string;
  name: string;
  created_by: string;
  visibility: 'personal' | 'group';
  groupIds: string[];
}

interface DeckListResult {
  items: DeckListItem[];
  total: number;
  hasMore: boolean;
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const res = await page.request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success`).toBe(true);
  return body.data;
}

/** The table row whose name cell is exactly `name` (the description may follow). */
function groupRow(page: Page, name: string): Locator {
  return page.locator('table tbody tr').filter({ has: page.getByText(name, { exact: true }) });
}

/** The deck card whose title is exactly `name` (same card on `/app` and `/edu`). */
function deckCard(page: Page, name: string): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

/** The label the `MultiSelect` shows for an addable member (`toGroupMemberOptions`). */
function optionLabel(member: { fullName: string | null; email: string }): string {
  return member.fullName ? `${member.fullName} (${member.email})` : member.email;
}

/** Replace a group's roster through the same endpoint the member dialog uses. */
async function setRoster(
  page: Page,
  groupId: string,
  members: { userId: string; role: 'teacher' | 'member' }[],
): Promise<void> {
  const res = await page.request.put(`${GROUPS_URL}/${groupId}/members`, { data: { members } });
  expect(
    res.ok(),
    `PUT ${GROUPS_URL}/${groupId}/members → ${res.status()} ${await res.text()}`,
  ).toBe(true);
}

async function listDecks(page: Page): Promise<DeckListResult> {
  return getJson<DeckListResult>(page, `${DECKS_URL}?sortBy=created_at&sortOrder=desc&limit=100`);
}

/**
 * The case's prerequisite group (EDU-GRP-01), created by the educator when the
 * tenant does not have it yet, with an empty roster so the walk starts at the
 * „Wybierz osoby…” state.
 */
async function ensureOwnedEmptyGroup(page: Page, name: string): Promise<GroupSummary> {
  let group = (await getJson<GroupSummary[]>(page, GROUPS_URL)).find(
    (candidate) => candidate.name === name,
  );

  if (!group) {
    const res = await page.request.post(GROUPS_URL, {
      data: { name, description: GROUP_DESCRIPTION },
    });
    expect(res.status(), `POST ${GROUPS_URL} (${name}) → ${res.status()} ${await res.text()}`).toBe(
      201,
    );
    const body = (await res.json()) as ApiEnvelope<
      Omit<GroupSummary, 'memberCount' | 'teacherCount'>
    >;
    expect(body.success, `POST ${GROUPS_URL} (${name}) success flag`).toBe(true);
    group = (await getJson<GroupSummary[]>(page, GROUPS_URL)).find(
      (candidate) => candidate.id === body.data.id,
    );
    if (!group) throw new Error(`POST ${GROUPS_URL} (${name}) created a group the list hides`);
  }

  const roster = await getJson<GroupMemberRow[]>(page, `${GROUPS_URL}/${group.id}/members`);
  if (roster.length > 0) {
    const reset = await page.request.put(`${GROUPS_URL}/${group.id}/members`, {
      data: { members: [] },
    });
    expect(
      reset.ok(),
      `PUT ${GROUPS_URL}/${group.id}/members (reset) → ${reset.status()} ${await reset.text()}`,
    ).toBe(true);
  }

  expect(group.canManage, `the educator created ${name} and may manage it`).toBe(true);
  return group;
}

/**
 * Content shared to the group: created by the educator (who is a group `teacher`
 * by the time this runs) or, on a re-run, reused and re-linked to the group.
 */
async function ensureGroupDeck(page: Page, groupId: string): Promise<DeckListItem> {
  const existing = (await listDecks(page)).items.find((deck) => deck.name === DECK_NAME);

  if (existing) {
    if (existing.groupIds?.includes(groupId)) return existing;
    const res = await page.request.put(`${DECKS_URL}/${existing.id}`, {
      data: { visibility: 'group', groupIds: [groupId] },
    });
    expect(res.ok(), `PUT ${DECKS_URL}/${existing.id} → ${res.status()} ${await res.text()}`).toBe(
      true,
    );
    return (await listDecks(page)).items.find((deck) => deck.name === DECK_NAME)!;
  }

  const res = await page.request.post(DECKS_URL, {
    data: { name: DECK_NAME, visibility: 'group', groupIds: [groupId] },
  });
  expect(res.status(), `POST ${DECKS_URL} → ${res.status()} ${await res.text()}`).toBe(201);
  const body = (await res.json()) as ApiEnvelope<DeckListItem>;
  expect(body.success, `POST ${DECKS_URL} success flag`).toBe(true);
  return body.data;
}

test.describe('@case:EDU-GRP-02 @area:EDU @prio:P2 group member management', () => {
  test('adds org members to the group and the student then sees content shared to it', async ({
    page,
  }) => {
    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the org-limit tenant profile`).toBe('org-limit');

    const manager = tenant.users.manager;
    const teacher = tenant.users.teacher;
    const secondTeacher = tenant.users.teacher2;
    const student = tenant.users.student;
    const invitee1 = tenant.users.invitee1;
    const invitee2 = tenant.users.invitee2;
    const defaultGroup = tenant.group;

    if (!manager || !teacher || !secondTeacher || !student || !invitee1 || !invitee2) {
      throw new Error(
        `${CASE} needs the org-limit tenant profile (org, four members, two invitees)`,
      );
    }
    if (!defaultGroup) {
      throw new Error(`${CASE} needs the org-limit tenant profile (org + default group)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisite: the educator owns „Grupa testowa”, created empty -------
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });

    const group = await ensureOwnedEmptyGroup(page, GROUP_NAME);

    // Only a group teacher may share content to a group, so the educator joins
    // the roster as its teacher for this one write, shares the deck, and then
    // clears the roster again: the case's member step still starts from the empty
    // EDU-GRP-01 group, with the content already attached to it.
    await setRoster(page, group.id, [{ userId: teacher.id, role: 'teacher' }]);
    const deck = await ensureGroupDeck(page, group.id);
    expect(deck.groupIds, 'the deck is shared to the case group').toEqual([group.id]);
    await setRoster(page, group.id, []);

    // The tenant's other group is the isolation control: editing the case group
    // must not touch it.
    const g1Before = (await getJson<GroupSummary[]>(page, GROUPS_URL)).find(
      (candidate) => candidate.id === defaultGroup.id,
    );
    expect(g1Before, `${defaultGroup.name} is listed for the educator`).toBeTruthy();

    // --- Premise: the content is NOT visible to a student outside the group --
    await page.context().clearCookies();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await page.goto('/app/flashcards');
    await expect(page).toHaveURL(/\/app\/flashcards$/);
    expect(
      (await listDecks(page)).items.some((candidate) => candidate.id === deck.id),
      'the student outside the group does not see the group deck',
    ).toBe(false);
    await expect(deckCard(page, DECK_NAME)).toHaveCount(0);

    // --- Step 0: the educator's group table, roster still empty --------------
    await page.context().clearCookies();
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    await page.goto('/edu/groups');
    await expect(page).toHaveURL(/\/edu\/groups$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();

    await expect(page.getByRole('columnheader', { name: COPY.nameColumn })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: COPY.membersColumn })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: COPY.teachersColumn })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: COPY.actionsColumn })).toBeVisible();

    const row = groupRow(page, GROUP_NAME);
    await expect(row, `${GROUP_NAME} is in the table`).toHaveCount(1);
    await expect(row.locator('td').nth(1), 'member count before the save').toHaveText('0');
    await expect(row.locator('td').nth(2), 'teacher count before the save').toHaveText('0');

    await expect(
      groupRow(page, defaultGroup.name).locator('td').nth(1),
      'untouched group member count',
    ).toHaveText(String(g1Before!.memberCount));

    // --- Step 1: „Zarządzaj członkami” --------------------------------------
    await row.getByRole('button', { name: COPY.manageMembers, exact: true }).click();

    const dialog = page.getByRole('dialog', { name: COPY.manageMembers });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveText(
      COPY.manageMembersDesc,
    );
    await expect(dialog.getByText(COPY.membersLabel, { exact: true })).toBeVisible();

    // --- Step 2: „Wybierz osoby…” offers exactly the org's own members -------
    const orgMembers = await getJson<OrgMember[]>(page, '/api/v1/organization/members');
    const addable = await getJson<AddableMember[]>(
      page,
      `${GROUPS_URL}/${group.id}/addable-members`,
    );
    expect(addable, 'the picker is built from the org member list').toHaveLength(orgMembers.length);

    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toContainText(COPY.membersPlaceholder);
    await combobox.click();

    const options = page.getByRole('option');
    await expect(options).toHaveCount(orgMembers.length);
    const optionTexts = await options.allInnerTexts();

    // Every org member is offered…
    for (const member of orgMembers) {
      expect(
        optionTexts.some((text) => text.includes(member.email)),
        `org member ${member.email} is offered`,
      ).toBe(true);
    }
    // …and nobody outside the organization is. The invitees exist in the tenant
    // but were never added to the org, so their emails must not appear.
    for (const outsider of [invitee1, invitee2]) {
      expect(
        optionTexts.some((text) => text.includes(outsider.email)),
        `non-member ${outsider.email} is not offered`,
      ).toBe(false);
    }

    const secondTeacherOption = addable.find((member) => member.id === secondTeacher.id);
    const studentOption = addable.find((member) => member.id === student.id);
    expect(secondTeacherOption?.orgRoleName, 'the second educator is an org teacher').toBe(
      'teacher',
    );
    expect(studentOption?.orgRoleName, 'the student is an org member').toBe('member');

    for (const option of [studentOption!, secondTeacherOption!]) {
      await page.getByRole('option', { name: optionLabel(option), exact: true }).click();
    }

    // The group role defaults from the org role: student → Członek,
    // teacher → Nauczyciel. That is what moves the teacher counter to 1.
    await expect(
      dialog.getByRole('combobox', { name: `${optionLabel(studentOption!)}: ${COPY.memberRoles}` }),
    ).toHaveText(COPY.roleMember);
    await expect(
      dialog.getByRole('combobox', {
        name: `${optionLabel(secondTeacherOption!)}: ${COPY.memberRoles}`,
      }),
    ).toHaveText(COPY.roleTeacher);

    // The multi-select stays open after a pick; close it so the click lands on
    // the dialog's own Save button.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option')).toHaveCount(0);

    await dialog.getByRole('button', { name: COPY.save, exact: true }).click();

    // --- Expected result: toast + table counters ----------------------------
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: COPY.membersUpdated }),
      'success toast',
    ).toBeVisible();
    await expect(dialog, 'the dialog closes after saving').toHaveCount(0);

    await expect(row.locator('td').nth(1), 'member count after the save').toHaveText('2');
    await expect(row.locator('td').nth(2), 'teacher count after the save').toHaveText('1');

    // Regression: the other group's counters are unchanged.
    await expect(
      groupRow(page, defaultGroup.name).locator('td').nth(1),
      'untouched group member count',
    ).toHaveText(String(g1Before!.memberCount));
    await expect(
      groupRow(page, defaultGroup.name).locator('td').nth(2),
      'untouched group teacher count',
    ).toHaveText(String(g1Before!.teacherCount));

    // Counters come from persisted state, not a stale optimistic list.
    await page.reload();
    await expect(page).toHaveURL(/\/edu\/groups$/);
    const reloaded = groupRow(page, GROUP_NAME);
    await expect(reloaded.locator('td').nth(1), 'persisted member count').toHaveText('2');
    await expect(reloaded.locator('td').nth(2), 'persisted teacher count').toHaveText('1');

    // --- API cross-check: exactly the two picked people, with their roles ----
    const rosterAfter = await getJson<GroupMemberRow[]>(page, `${GROUPS_URL}/${group.id}/members`);
    expect(rosterAfter, 'the saved roster').toHaveLength(2);
    expect(rosterAfter).toEqual(
      expect.arrayContaining([
        { userId: secondTeacher.id, role: 'teacher' },
        { userId: student.id, role: 'member' },
      ]),
    );

    // --- Expected result: the added student sees the group's content --------
    await page.context().clearCookies();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await page.goto('/app/flashcards');
    await expect(page).toHaveURL(/\/app\/flashcards$/);

    const studentDecks = await listDecks(page);
    const shared = studentDecks.items.find((candidate) => candidate.id === deck.id);
    expect(shared, 'the group deck is readable by the added student').toBeTruthy();
    expect(shared?.groupIds, 'readable through the case group').toContain(group.id);

    const card = deckCard(page, DECK_NAME);
    await expect(card, 'the shared deck is on the student’s deck page').toBeVisible();
    await expect(
      card.locator('[data-slot="badge"]:visible').filter({ hasText: GROUP_NAME }),
      'the card carries the group badge',
    ).toHaveCount(1);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
