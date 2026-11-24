# STU-13 — Strona „Na żywo” (funkcja w przygotowaniu)

- id: STU-13
- priority: P3 kosmetyczny
- module: STU – Panel studenta (/app)
- section: Na żywo (Live)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1.

## Seed (QA-suite)

- Tenant: `bun scripts/qa-tenant.ts STU-13 --fresh`, profile `content`
  (`__tests__/qa/profiles/STU-13.json`) — its own organization, manager, teacher and student.
- Accounts: the legacy `student1@dev.local` is the tenant's `users.student`
  (`loginAs(page, tenant, 'student')`); no legacy/manual account is used.
- Content: none. The page renders no tenant data, so the spec seeds nothing and
  depends on no shared row; it only asserts copy and navigation.
- UI note: the case says „wpisz dowolny kod”; the shipped control has six slots
  (`SESSION_CODE_LENGTH = 6`) and „Dołącz do sesji” stays disabled until all six
  are filled. „Dowolny kod” therefore means any six characters; the guard is what
  prevents an empty join, so the test asserts it as intended behavior.

## Steps

1. Otwórz /app/study/live.
2. Wpisz dowolny kod w „Kod sesji” i kliknij „Dołącz do sesji”.
3. Otwórz /app/study/live/faq.

## Expected result

- Strona opisuje trzy kroki oraz komunikat „Sesje na żywo już wkrótce!”.
- Próba dołączenia nie powoduje awarii (brak realnej funkcji – zanotuj faktyczne zachowanie).
- Strona FAQ „Jak dołączyć do sesji na żywo” ładuje się poprawnie.

## Kontrakt trasy (2026-11-24, ADR-0015 §7.1)

`/app/study/live` należy do powłoki osobistej `/app`, która wymaga wyłącznie
zalogowania — nie persony. Nauczyciel, który otworzy ten adres, pozostaje na nim
i widzi tę samą stronę „w przygotowaniu”; granicą jest warstwa danych
wywołującego (`/api/v1/me/personal-plan` zwraca jego własny plan), a nie
przekierowanie na `/edu`. Wylogowany gość nadal trafia na `/login?next=…`.
