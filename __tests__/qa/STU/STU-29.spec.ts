import type { Page } from '@playwright/test';
import {
  expect,
  loadTenant,
  loginAs,
  test,
  type QaRole,
  type QaTenant,
} from '@qa/fixtures/qa-tenant';

/**
 * STU-29 — a student opens an educator's deck read-only and cannot modify its
 * flashcard (/app/flashcards/<id>).
 *
 * Case (verbatim → tenant model): the legacy prerequisite `student1` (S1) opening
 * teacher1's deck `O1G1T1` in WSB Merito / group O1G1 is never played with the
 * `@dev.local` accounts or password `pass`. The spec reads its own tenant, seeded
 * fresh for every independent run:
 *
 *   bun scripts/qa-tenant.ts STU-29 --fresh
 *
 * `__tests__/qa/profiles/STU-29.json` declares the `content` profile: one organization
 * with its default group `G1`, a `manager` (org admin, `G1` teacher), the
 * `teacher` (the case's T1) and the `student` (S1, `G1` member). Every id derives
 * from `tenantKey('qa/cases/STU-29.md', 'STU-29#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`; nothing global is read or written.
 *
 * Prerequisite, prepared idempotently through the product API inside this tenant:
 * 1. The manager promotes the educator to group `teacher` of `G1` (the seeder
 *    enrols group members as `member`, and only a group teacher may share content
 *    to a group) via `PUT /api/v1/organization/groups/:id/members` — the same
 *    write `/manage/groups` performs.
 * 2. The educator creates the bank `STU-29 bank` shared to `G1`, one question in
 *    it, and the deck `O1G1T1` shared to `G1` with one card created from that
 *    question. The question link is required for the case's
 *    „Zgłoś nieprawidłowość” point: the product only offers the report action for
 *    cards generated from an official question (standalone cards have no report
 *    thread).
 *
 * Acceptance points walked on the shared app (:3010, worker qa-env-2) on 2026-10-29:
 * 1. `/app/flashcards` shows the educator's deck with the read-only entry point
 *    („Przeglądaj”), never the owner's „Zarządzaj”. The case quotes „Podgląd”;
 *    the product renders „Przeglądaj” (`Common.common_view`) — a P3 copy difference,
 *    so the test asserts the read-only entry point and that the manage label is
 *    absent, not the word itself.
 * 2. The deck view has no „Dodaj fiszkę” action, and the card's menu offers
 *    „Wybierz Fiszki”, „Kopiuj do Innej Talii” and „Zgłoś nieprawidłowość” only —
 *    no „Edytuj”, „Usuń”, „Tematy” or „Przenieś do Innej Talii”. The deck menu has
 *    no „Edytuj”/„Usuń” either. „Zgłoś nieprawidłowość” opens the
 *    „Zgłoś nieprawidłowość pytania” dialog.
 * 3. `PUT` and `DELETE /api/v1/flashcards/<T1 card>` as S1 answer **403
 *    FORBIDDEN** (the case's 403/404), the envelope carries no payload, and the
 *    card keeps its front/back — still rendered in the deck, „hack” never shown.
 *
 * Adjacent regression on the same surface: the owner (T1, `/edu/flashcards`)
 * sees „Zarządzaj”, „Dodaj fiszkę” and the menu's „Edytuj”/„Usuń”, and a no-op
 * `PUT` of his own card succeeds (200) — the 403 is the per-resource ownership
 * boundary, not a broken view or route.
 */

const CASE = 'STU-29';

const DECKS_URL = '/api/v1/flashcards/decks';
const CARDS_URL = '/api/v1/flashcards';
const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const ME_URL = '/api/v1/auth/me';

/** The case's deck name (legacy seed: „O1G1T1”, teacher1's deck in O1G1). */
const DECK_NAME = 'O1G1T1';
const BANK_NAME = 'STU-29 bank';
const QUESTION_CONTENT = 'STU-29: Ile wynosi 2+2?';

/** Polish copy as rendered by the current product (pl.json). */
const COPY = {
  manage: 'Zarządzaj',
  // The case says „Podgląd”; the product renders „Przeglądaj” for the same
  // view-only affordance — a P3 copy difference, documented on the case.
  view: 'Przeglądaj',
  addCard: 'Dodaj fiszkę',
  edit: 'Edytuj',
  delete: 'Usuń',
  move: 'Przenieś do Innej Talii',
  topics: 'Tematy',
  report: 'Zgłoś nieprawidłowość',
  reportDialogTitle: 'Zgłoś nieprawidłowość pytania',
  send: 'Wyślij',
  suspendDeck: 'Zawieś talię',
} as const;

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Deck {
  id: string;
  name: string;
  created_by: string;
  organization_id: string | null;
  visibility: 'personal' | 'group';
  groupIds?: string[];
  flashcard_count: number;
}

interface Card {
  id: string;
  front: string;
  back: string;
  deck_id: string;
  created_by: string;
  organization_id: string | null;
  question_id: string | null;
}

interface Bank {
  id: string;
  name: string;
  created_by: string;
  organization_id: string | null;
  visibility: 'personal' | 'group';
  groupIds?: string[];
}

interface Question {
  id: string;
  content: string;
  created_by: string;
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

interface Me {
  user?: { id?: string; app_metadata?: { account_type?: string } };
}

interface CallResult {
  status: number;
  errorCode: string | null;
  body: string;
}

function account(tenant: QaTenant, role: QaRole) {
  const user = tenant.users[role];
  if (!user) throw new Error(`tenant ${tenant.case} has no seeded ${role} user`);
  return user;
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(200);
  const body = (await response.json()) as Envelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data as T;
}

async function call(
  page: Page,
  method: 'GET' | 'PUT' | 'DELETE' | 'POST',
  url: string,
  data?: unknown,
): Promise<CallResult> {
  const response =
    method === 'GET'
      ? await page.request.get(url)
      : method === 'PUT'
        ? await page.request.put(url, { data: data ?? {} })
        : method === 'DELETE'
          ? await page.request.delete(url)
          : await page.request.post(url, { data: data ?? {} });
  return {
    status: response.status(),
    errorCode: response.headers()['x-error-code'] ?? null,
    body: await response.text(),
  };
}

/** A fresh session for one tenant user; cookies are cleared so roles never overlap. */
async function switchUser(
  page: Page,
  tenant: QaTenant,
  role: QaRole,
  waitFor: RegExp,
): Promise<void> {
  await page.context().clearCookies();
  await loginAs(page, tenant, role, { locale: 'pl', waitFor });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
}

async function expectSignedInAs(page: Page, tenant: QaTenant, role: QaRole): Promise<void> {
  const user = account(tenant, role);
  const me = (await (await page.request.get(ME_URL)).json()) as Envelope<Me>;
  expect(me.data?.user?.id, `the signed-in user is the tenant's ${role}`).toBe(user.id);
}

/**
 * The seeder enrols `G1` members with the group role `member`, but only a group
 * `teacher` may share content to the group. Promote the educator through the
 * manager's own roster endpoint — the same write `/manage/groups` performs.
 */
async function ensureEducatorLeadsGroup(page: Page, tenant: QaTenant): Promise<void> {
  const groupId = tenant.group?.id;
  const educator = tenant.users.teacher;
  if (!groupId || !educator) {
    throw new Error(`${CASE} needs the content tenant profile (org, group and educator)`);
  }

  const url = `/api/v1/organization/groups/${groupId}/members`;
  const roster = await getData<GroupMemberRow[]>(page, url);
  const member = roster.find((row) => row.userId === educator.id);
  expect(member, 'the seeded educator is a member of the tenant group').toBeTruthy();
  if (member!.role === 'teacher') return;

  const response = await page.request.put(url, {
    data: {
      members: roster.map((row) =>
        row.userId === educator.id ? { userId: row.userId, role: 'teacher' } : row,
      ),
    },
  });
  expect(response.ok(), `PUT ${url} → ${response.status()} ${await response.text()}`).toBe(true);

  const after = await getData<GroupMemberRow[]>(page, url);
  expect(
    after.find((row) => row.userId === educator.id)?.role,
    'the educator now teaches the tenant group',
  ).toBe('teacher');
}

/**
 * The case's `O1G1T1` bank and question, created once per tenant and reused on a
 * retry (CI seeds once and retries the same tenant).
 */
async function ensureQuestion(page: Page, tenant: QaTenant): Promise<Question> {
  const group = tenant.group;
  const teacher = tenant.users.teacher;
  if (!group || !teacher) {
    throw new Error(`${CASE} needs the content tenant profile (group and educator)`);
  }

  const banks = await getData<{ items: Bank[] }>(page, `${BANKS_URL}?limit=100`);
  let bank = banks.items.find((row) => row.name === BANK_NAME);
  if (!bank) {
    const response = await page.request.post(BANKS_URL, {
      data: { name: BANK_NAME, visibility: 'group', groupIds: [group.id] },
    });
    expect(
      response.status(),
      `POST ${BANKS_URL} (${BANK_NAME}) → ${response.status()} ${await response.text()}`,
    ).toBe(201);
    bank = ((await response.json()) as Envelope<Bank>).data!;
  }
  expect(bank.created_by, 'the bank is owned by the tenant educator').toBe(teacher.id);
  expect(bank.organization_id, 'the bank belongs to the tenant organization').toBe(tenant.org?.id);

  const questions = await getData<Question[]>(page, `${QUESTIONS_URL}?bankId=${bank.id}`);
  const existing = questions.find((question) => question.content === QUESTION_CONTENT);
  if (existing) return existing;

  const response = await page.request.post(QUESTIONS_URL, {
    data: {
      bankId: bank.id,
      type: 'mcq',
      content: QUESTION_CONTENT,
      answers: [
        { content: '4', isCorrect: true, orderIndex: 0 },
        { content: '5', isCorrect: false, orderIndex: 1 },
      ],
    },
  });
  expect(
    response.status(),
    `POST ${QUESTIONS_URL} (${QUESTION_CONTENT}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as Envelope<Question>).data!;
}

/** `O1G1T1`, shared to `G1`, owned by the educator — the case's teacher deck. */
async function ensureDeck(page: Page, tenant: QaTenant): Promise<Deck> {
  const group = tenant.group;
  const teacher = tenant.users.teacher;
  if (!group || !teacher) {
    throw new Error(`${CASE} needs the content tenant profile (group and educator)`);
  }

  const decks = await getData<{ items: Deck[] }>(page, `${DECKS_URL}?limit=100`);
  const existing = decks.items.find((row) => row.name === DECK_NAME);
  if (!existing) {
    const response = await page.request.post(DECKS_URL, {
      data: { name: DECK_NAME, visibility: 'group', groupIds: [group.id] },
    });
    expect(
      response.status(),
      `POST ${DECKS_URL} (${DECK_NAME}) → ${response.status()} ${await response.text()}`,
    ).toBe(201);
    const created = ((await response.json()) as Envelope<Deck>).data!;
    expect(created.created_by, 'the deck belongs to the tenant educator').toBe(teacher.id);
    return created;
  }

  expect(existing.created_by, 'the deck belongs to the tenant educator').toBe(teacher.id);
  if (existing.visibility === 'group' && (existing.groupIds ?? []).includes(group.id)) {
    return existing;
  }

  // A half-finished earlier run could have left the deck personal; restore the
  // group share through the product instead of creating a second deck.
  const response = await page.request.put(`${DECKS_URL}/${existing.id}`, {
    data: { name: DECK_NAME, visibility: 'group', groupIds: [group.id] },
  });
  expect(
    response.status(),
    `PUT ${DECKS_URL}/${existing.id} → ${response.status()} ${await response.text()}`,
  ).toBe(200);
  return ((await response.json()) as Envelope<Deck>).data!;
}

/**
 * One card in `O1G1T1`, linked to the case's question (the report option only
 * exists for question-generated cards). Reused when a retry already created it;
 * a card left without the link is removed by its owner and recreated.
 */
async function ensureCard(
  page: Page,
  tenant: QaTenant,
  deck: Deck,
  question: Question,
): Promise<Card> {
  const teacher = tenant.users.teacher;
  if (!teacher) throw new Error(`${CASE} needs the content tenant profile (an educator)`);
  const run = tenant.runSuffix ?? tenant.key.slice(-8);
  const front = `STU-29 fiszka ${run}`;
  const back = `STU-29 odpowiedź ${run}`;

  const listed = await getData<{ items: Card[] }>(page, `${CARDS_URL}?deckIds=${deck.id}&limit=50`);
  let card = listed.items.find((row) => row.front === front);

  if (card && card.question_id !== question.id) {
    const removed = await page.request.delete(`${CARDS_URL}/${card.id}`);
    expect(
      removed.status(),
      `DELETE ${CARDS_URL}/${card.id} (stale card, owner) → ${removed.status()} ${await removed.text()}`,
    ).toBe(200);
    card = undefined;
  }

  if (!card) {
    const response = await page.request.post(CARDS_URL, {
      data: { deckId: deck.id, questionId: question.id, front, back },
    });
    expect(
      response.status(),
      `POST ${CARDS_URL} (${front}) → ${response.status()} ${await response.text()}`,
    ).toBe(201);
    card = ((await response.json()) as Envelope<Card>).data!;
  }

  expect(card.created_by, 'the card belongs to the tenant educator').toBe(teacher.id);
  expect(card.question_id, 'the card is linked to the case question').toBe(question.id);
  expect(card.deck_id, 'the card lives in O1G1T1').toBe(deck.id);
  return card;
}

/**
 * The case accepts 403 or 404 for a rejected foreign write. The error code must
 * agree with the status, so a 403 cannot masquerade as validation, and the
 * envelope carries no payload — a refused operation must not leak the resource.
 */
function expectRejected(result: CallResult, label: string): void {
  expect([403, 404], `${label}: rejected with 403/404 → ${result.status} ${result.body}`).toContain(
    result.status,
  );
  const expected = result.status === 403 ? 'FORBIDDEN' : 'NOT_FOUND';
  expect(result.errorCode, `${label}: x-error-code header`).toBe(expected);
  expect(JSON.parse(result.body), `${label}: response envelope`).toEqual({
    success: false,
    error: expected,
  });
}

/** The visible, desktop trigger of a card/deck overflow menu. */
function menuTrigger(page: Page, label: RegExp) {
  return page.getByRole('button', { name: label }).filter({ visible: true });
}

/** The flashcard card (one deck row) that holds the given front text. */
function flashcardCard(page: Page, front: string) {
  return page.locator('[data-slot="card"]').filter({ hasText: front }).first();
}

test.describe('@case:STU-29 @area:STU @prio:P1 teacher deck is read-only for a student', () => {
  test("a student opens the educator's deck read-only and cannot change its flashcard", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.key, `${CASE} tenant key`).toContain(`${CASE}.md::${CASE}`);
    const org = tenant.org;
    const group = tenant.group;
    const teacher = account(tenant, 'teacher');
    if (!org || !group) throw new Error(`${CASE} tenant is missing its organization or group`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prereq: the educator may share content with G1 ---------------------
    await switchUser(page, tenant, 'manager', /\/manage(\/|$)/);
    await ensureEducatorLeadsGroup(page, tenant);

    // --- Prereq: the educator owns O1G1T1 with a question-linked card -------
    await switchUser(page, tenant, 'teacher', /\/edu(\/|$)/);
    const question = await ensureQuestion(page, tenant);
    const deck = await ensureDeck(page, tenant);
    const card = await ensureCard(page, tenant, deck, question);

    console.log(`${CASE} tenant key: ${tenant.key}`);
    console.log(`${CASE} org: ${org.id} (${org.name}) / group: ${group.id} (${group.name})`);
    console.log(`${CASE} deck: ${deck.id} ${deck.name} / card: ${card.id} ${card.front}`);

    // --- Step 1: S1's deck list shows the read-only entry point -------------
    await switchUser(page, tenant, 'student', /\/app(\/|$)/);
    await expectSignedInAs(page, tenant, 'student');

    await page.goto('/app/flashcards');
    const deckCard = page.locator('[data-slot="card"]').filter({ hasText: DECK_NAME }).first();
    await expect(deckCard, "the educator's deck is listed for the student").toBeVisible();
    await expect(
      deckCard
        .getByRole('heading', { name: DECK_NAME, exact: true })
        .filter({ visible: true })
        .first(),
      'the deck card carries the deck name',
    ).toBeVisible();

    // The case's „Podgląd” is rendered as „Przeglądaj” (P3 copy difference):
    // assert the view-only entry point and that the owner's label is absent.
    const viewAction = deckCard
      .getByRole('button', { name: COPY.view, exact: true })
      .filter({ visible: true });
    await expect(viewAction, 'the deck carries the read-only entry point').toHaveCount(1);
    await expect(
      deckCard.getByRole('button', { name: COPY.manage, exact: true }),
      'a student never gets the owner label on a foreign deck',
    ).toHaveCount(0);

    // --- Step 2: the deck view offers no writing action ---------------------
    await viewAction.click();
    await expect(page).toHaveURL(new RegExp(`/app/flashcards/${deck.id}$`));
    await expect(page.getByRole('heading', { name: DECK_NAME, exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(card.front, { exact: true }).filter({ visible: true }).first(),
      'the card content is readable',
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: COPY.addCard, exact: true }),
      'no add-card action on a foreign deck',
    ).toHaveCount(0);

    // Card menu: report only, none of the owner actions.
    const studentCard = flashcardCard(page, card.front);
    await expect(studentCard, 'the question-linked card is readable').toBeVisible();
    await studentCard
      .getByRole('button', { name: /Więcej akcji fiszki/ })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole('menuitem', { name: COPY.report, exact: true }),
      'the case requires „Zgłoś nieprawidłowość” in the card menu',
    ).toBeVisible();
    for (const label of [COPY.edit, COPY.delete, COPY.topics, COPY.move]) {
      await expect(
        page.getByRole('menuitem', { name: label, exact: true }),
        `„${label}” is not offered for a foreign card`,
      ).toHaveCount(0);
    }

    // The report action is wired to the question, not a dead menu entry.
    await page.getByRole('menuitem', { name: COPY.report, exact: true }).click();
    const reportDialog = page.getByRole('dialog');
    await expect(reportDialog, 'the report dialog opens').toBeVisible();
    await expect(
      page.getByRole('heading', { name: COPY.reportDialogTitle, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: COPY.send, exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(reportDialog).toBeHidden();

    // Deck menu: no deck edit/delete either (suspending is a per-user preference).
    await menuTrigger(page, /Więcej akcji talii/).click();
    await expect(
      page.getByRole('menuitem', { name: COPY.suspendDeck, exact: true }),
      'the student can still suspend the deck for their own study',
    ).toBeVisible();
    for (const label of [COPY.edit, COPY.delete]) {
      await expect(
        page.getByRole('menuitem', { name: label, exact: true }),
        `„${label}” is not offered on a foreign deck`,
      ).toHaveCount(0);
    }
    await page.keyboard.press('Escape');

    // --- Step 3: PUT/DELETE of the educator's card are refused --------------
    expectRejected(
      await call(page, 'PUT', `${CARDS_URL}/${card.id}`, { front: 'hack' }),
      'S1 PUT /flashcards/<T1 card>',
    );
    expectRejected(
      await call(page, 'DELETE', `${CARDS_URL}/${card.id}`),
      'S1 DELETE /flashcards/<T1 card>',
    );

    // --- The card is untouched ---------------------------------------------
    const cardAfter = await getData<Card>(page, `${CARDS_URL}/${card.id}`);
    expect(cardAfter, 'the refused writes left the card as it was').toMatchObject({
      id: card.id,
      front: card.front,
      back: card.back,
      deck_id: deck.id,
      created_by: teacher.id,
      question_id: question.id,
    });
    const deckAfter = await getData<Deck>(page, `${DECKS_URL}/${deck.id}`);
    expect(deckAfter, 'the deck still exists with its name and share').toMatchObject({
      id: deck.id,
      name: DECK_NAME,
      created_by: teacher.id,
      visibility: 'group',
    });
    expect(deckAfter.groupIds ?? [], 'the deck is still shared to G1').toContain(group.id);

    await page.reload();
    await expect(
      page.getByText(card.front, { exact: true }).filter({ visible: true }).first(),
      'the untouched card still renders in the deck',
    ).toBeVisible();
    await expect(
      page.getByText('hack', { exact: true }),
      'the attempted front never reached the UI',
    ).toHaveCount(0);

    // --- Positive control: the same screen is writable for its owner --------
    await switchUser(page, tenant, 'teacher', /\/edu(\/|$)/);
    await expectSignedInAs(page, tenant, 'teacher');

    await page.goto('/edu/flashcards');
    const ownerCard = page.locator('[data-slot="card"]').filter({ hasText: DECK_NAME }).first();
    await expect(ownerCard, "the educator's deck is listed for its owner").toBeVisible();
    await expect(
      ownerCard.getByRole('button', { name: COPY.manage, exact: true }).filter({ visible: true }),
      'the owner gets „Zarządzaj” on the same deck',
    ).toHaveCount(1);
    await expect(
      ownerCard.getByRole('button', { name: COPY.view, exact: true }),
      'the owner never gets the read-only label',
    ).toHaveCount(0);

    await page.goto(`/edu/flashcards/${deck.id}`);
    await expect(
      page.getByRole('button', { name: COPY.addCard, exact: true }).filter({ visible: true }),
      'the owner can add a card',
    ).toHaveCount(1);
    const ownerFlashcard = flashcardCard(page, card.front);
    await expect(ownerFlashcard, 'the owner sees the same card').toBeVisible();
    await ownerFlashcard
      .getByRole('button', { name: /Więcej akcji fiszki/ })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole('menuitem', { name: COPY.edit, exact: true }),
      'the owner can edit the card',
    ).toHaveCount(1);
    await expect(
      page.getByRole('menuitem', { name: COPY.delete, exact: true }),
      'the owner can delete the card',
    ).toHaveCount(1);
    await page.keyboard.press('Escape');

    // The owner's write succeeds — the student's 403 is authorization, not a
    // broken route (a no-op update keeps the tenant retry-safe).
    const ownerUpdate = await call(page, 'PUT', `${CARDS_URL}/${card.id}`, {
      front: card.front,
      back: card.back,
    });
    expect(ownerUpdate.status, `T1 updates their own card → ${ownerUpdate.body}`).toBe(200);
    expect((JSON.parse(ownerUpdate.body) as Envelope<Card>).data).toMatchObject({
      id: card.id,
      front: card.front,
      back: card.back,
    });

    const ownerRead = await getData<Card>(page, `${CARDS_URL}/${card.id}`);
    expect(ownerRead, 'the card still carries the original content').toMatchObject({
      front: card.front,
      back: card.back,
      question_id: question.id,
    });

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
