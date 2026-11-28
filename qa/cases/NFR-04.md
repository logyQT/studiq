# NFR-04 — Widok mobilny (375 × 812)

- id: NFR-04
- priority: P1 krytyczny
- module: NFR – Wymagania niefunkcjonalne i międzyobszarowe
- section: Responsywność i dostępność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

DevTools → tryb urządzenia.

## Steps

1. Dla S1, T1 i M1 przejdź przez najważniejsze ekrany: pulpit, lista talii, sesja nauki, quiz, edytor quizu, lista członków, formularz kartkówki.
2. Otwórz menu boczne (hamburger) i przełącznik organizacji.

## Expected result

- Brak poziomego przewijania strony; tabele przewijają się wewnątrz własnego kontenera.
- Przyciski w sesji nauki i quizie dostępne kciukiem, nie nachodzą na siebie.
- Okna dialogowe mieszczą się w ekranie i da się je zamknąć.

## QA tenant fixture (reconciled)

The case needs no data beyond the suite's default tenant. „DevTools → tryb urządzenia” becomes
the spec's own viewport override, not a manual prerequisite.

- Profile: `content` (no profile file) — one organization with the default group `G1` and one
  account per account type: `manager`, `teacher`, `student`.
- Seed: `bun scripts/qa-tenant.ts NFR-04 --fresh` — a fresh run suffix per independent run, so
  every run gets its own org/group/users from
  `tenantKey('qa/cases/NFR-04.md', 'NFR-04#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the credentials through `loadTenant('NFR-04')`.
- Viewport: the spec sets `375 × 812` with `hasTouch: true` for its own file
  (`test.use(...)`); the QA runner stays chromium-only.
- Screens, in the case's order, each loaded as a full document: student `/app` (pulpit),
  `/app/flashcards` (lista talii), `/app/study/session/new` (sesja nauki),
  `/app/study/session/quiz/<attempt>` (quiz); educator `/edu`, `/edu/quizzes/new` (edytor
  quizu), `/edu/assignments/new` (formularz kartkówki); manager `/manage`, `/manage/members`
  (lista członków). The sidebar hamburger and the organization switcher are opened on
  `/manage/members`.
- Content created by the spec through the product API inside its own tenant: one deck with
  three flashcards (student) and one question bank with a multiple-choice and a true/false
  question, then a two-question practice attempt (student). Names carry the run suffix.
- Not used: global admin settings, feature flags, plan rows/catalogues, platform stats,
  singleton rows or another tenant.
