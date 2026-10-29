# EDU-ST-01 — Statystyki – „Treści” (/edu/stats/data)

- id: EDU-ST-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Statystyki nauczyciela
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany TC.

## Steps

1. Otwórz /edu/stats/data.
2. Zmień filtr „Wszystkie przedmioty”.

## Expected result

- Karty: Wszystkie pytania, fiszki, talie, studenci; karta „Studenci” pokazuje liczbę uczniów w grupach TC w aktywnej organizacji (seed Classroom: 1), a pod wartością podpis „Aktywnych: N” — liczbę studentów, którzy ćwiczyli (TC nie jest liczony).
- Po jednej powtórce studenta „Aktywnych” rośnie o 1, a pasek postępu karty jest wypełniony; powtórka samego TC nie zmienia „Aktywnych”.
- Przełączenie organizacji zmienia liczbę studentów na właściwą dla aktywnej organizacji; TC bez aktywnej organizacji nie widzi karty „Studenci” (zamiast gołego 0).
- Podział „Pytania według typu” (WW/PF/Otwarte) i „według przedmiotu”; tabele liczby talii i tematów.
- Linki „Zobacz szczegółowe statystyki pytań / fiszek” działają.
- Na /edu/flashcards/stats karta studentów ma etykietę „Studenci, którzy ćwiczyli” (bez nowej karty i bez zmiany siatki).
- TC: 10 pytań – 4 wielokrotnego wyboru, 3 prawda/fałsz, 3 otwarte (zgodnie z seedem).

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher-classroom@dev.local`, password
`pass`, organization Classroom, group „Classroom Group”, 2 banks / 10 questions / 2 decks × 4
cards / 2 topics / 1 student). The suite version uses the case's own tenant and never the
legacy accounts.

- Profile: `content` (`qa/tests/profiles/EDU-ST-01.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`, group `teacher`),
  `teacher` (account type `educator`, org `member`, the case's TC) and `student` (org member,
  group `member` — the one learner the „Studenci” card counts).
- Seed: `bun scripts/qa-tenant.ts EDU-ST-01 --fresh` — a fresh run suffix per independent run,
  so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-ST-01.md', 'EDU-ST-01#<suffix>', 'qa-shared')` + `tenantId(key,
entity)`. The spec reads the ids through `loadTenant('EDU-ST-01')`.
- Content (created by the spec through the product API, idempotently, so a CI retry on the
  same tenant neither duplicates nor fails):
  - banks „Historia” (4 questions) and „Geografia i Nauka” (6) — 10 questions in total: 4
    multiple choice, 3 true/false, 3 open (the case's TC shape);
  - decks „Historia – fiszki” and „Geografia – fiszki”, 4 flashcards each (8), shared to `G1`
    so the student can practise them;
  - topics „Średniowiecze” and „Odkrycia geograficzne”, 4 flashcards each.
- The tenant seeder enrols group members as group `member`; only a group `teacher` may share
  content to a group, so the spec promotes the teacher to group `teacher` through the manager's
  own roster endpoint (`PUT /api/v1/organization/groups/:id/members`, the write `/manage/groups`
  performs). That write is tenant-local and idempotent.
- Practice state: CI seeds one tenant per spec and Playwright retries reuse it, so the
  „Aktywnych” leg starts by clearing this tenant's own `flashcard_practice` /
  `flashcard_review_state` rows (service-role client, keyed by the tenant's own user ids — the
  same pattern STU-02 uses). The practice itself is logged through
  `POST /api/v1/flashcards/:id/practice` once as the teacher and once as the student.
- Not used: switching between two organizations. The `content` tenant has one organization and
  no seeder profile gives an educator two memberships, so the „przełączenie organizacji” leg
  needs its own fixture. The „TC bez aktywnej organizacji nie widzi karty” leg is asserted on
  the endpoint the card renders from (`rosterStudents: null` without `active_org_id`, the real
  class size after `POST /api/v1/me/orgs/switch`): in the browser the app always has an active
  organization — `useOrgs` auto-selects the only membership and a teacher without an
  organization is redirected to `/setup` — so the hidden-card state is not reachable through
  the UI.
- Spec: `qa/tests/EDU/EDU-ST-01.spec.ts`, project `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (the document quotes Polish copy).
