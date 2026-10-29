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

The case was written against the legacy manual seed (`student1@dev.local`,
`teacher1@dev.local`, `manager@dev.local`, password `pass`). The suite version uses the
case's own tenant and never the legacy accounts.

- Profile: `content` (`qa/tests/profiles/NFR-04.json`) — one organization
  (`qa-nfr-04-<suffix>`), its default group `G1`, and one account per account type:
  S1 → `users.student`, T1 → `users.teacher`, M1 → `users.manager`.
- Seed: `bun scripts/qa-tenant.ts NFR-04 --fresh` — a fresh run suffix per independent run,
  so every run gets its own org/group/users from
  `tenantKey('qa/cases/NFR-04.md', 'NFR-04#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids and credentials through `loadTenant('NFR-04')`.
- Device mode: the Playwright run emulates the case's DevTools prerequisite on the runner's
  single Chromium project — `viewport: 375 × 812`, `isMobile`, `hasTouch`,
  `deviceScaleFactor: 3`. The layout contract is the 375 px width (the product's `sm`
  breakpoints and the sidebar's `768 px` `matchMedia`), not the UA, so the emulation is
  spelled out rather than borrowing a device descriptor — a descriptor carries its own
  browser engine, and this runner ships Chromium only.
- Content created by the spec through the product API and reset on every run: one personal
  deck with three flashcards (study session) and a two-question multiple-choice bank
  (practice quiz). A student's `question.read` scope is `own`, so the quiz is generated from
  that student's own bank; the spec creates the bank as the student for the same reason.
- Screens by role: student — `/app` (pulpit), `/app/flashcards` (lista talii),
  `/app/study/session/cram?deckId=…` (sesja nauki), `/app/study/quiz` and
  `/app/study/session/quiz/<attempt>` (quiz); teacher — `/edu` (pulpit), `/edu/flashcards`,
  `/edu/quizzes/new` (edytor quizu), `/edu/assignments/new` (formularz kartkówki),
  `/edu/classroom/members` (lista członków); manager — `/manage` (pulpit),
  `/manage/members` (lista członków).
- Organization switcher: the `content` tenant has one organization, so step 2 asserts that
  the switcher opens inside the screen, lists that organization and closes. Switching
  between two organizations is MGR-03's subject, not this case's expected result.
- Not used: global admin settings, feature flags, plan rows/catalogues, platform stats,
  singleton rows or another tenant.

## Walk observations (shared app, 375 × 812)

- Every screen under test keeps the document at the viewport width
  (`documentElement.scrollWidth` = `body.scrollWidth` = 375) and a horizontal page scroll is
  a no-op. That includes `/app`, `/app/flashcards`, `/app/study/quiz`, the study and quiz
  sessions, `/edu`, `/edu/flashcards`, `/edu/quizzes/new`, `/edu/assignments/new`,
  `/edu/classroom/members`, `/manage` and `/manage/members`.
- Tables do overflow their own container, not the page: `/manage/members`
  (`scrollWidth` 843 vs `clientWidth` 326) and `/edu/classroom/members` (480 vs 278), both
  with `overflow-x: auto` and the container's right edge inside the 375 px screen. Setting
  `scrollLeft` on the container scrolls it.
- Study session („Wkuwaj” with a deck): the four rating buttons are a two-column grid —
  measured 167.5 × 36 px with a 16 px gutter, no overlap, the lower row ending at ~628 px.
  „Zakończ sesję” sits top-right (32 px tall).
- Quiz session (two questions): „Poprzednie” (130 × 36) and „Następne” (114 × 36) share one
  row with a ~50 px gap; every answer row is full width inside the card.
- Hamburger: a 28 × 28 trigger at (12, 13.5) opens the mobile sidebar as a sheet
  288 × 812 at x = 0. The organization switcher inside it opens a 271 × 135 menu at x = 8;
  Escape closes the menu and then the sidebar.
- Dialogs: the student's „Nowa talia” form (opened from the mobile speed dial) measures
  375 × 379 at y = 216.5 and closes with Escape; the manager's „Nowa grupa” form measures
  343 × 312 and closes with its „Close” button. Neither adds horizontal page scroll.
- The deck list renders the deck title twice (mobile and desktop markup, one `display:none`),
  so selectors must filter by visibility — not a layout issue.
- „Formularz kartkówki” is the teacher's `/edu/assignments/new` page; its primary action is
  „Utwórz kartkówkę”. The quiz editor `/edu/quizzes/new` renders its „Utwórz quiz” action
  without horizontal scroll.
