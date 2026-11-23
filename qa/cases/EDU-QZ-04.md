# EDU-QZ-04 — Autozapis i zapis ręczny

- id: EDU-QZ-04
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Quizy – kreator (/edu/quizzes)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Edytor quizu.

> 2026-11-23 (phase 5d): the editor's save path (`PUT /api/v1/teacher/quizzes/:id/bulk`) is
> gated on the `quiz.templates` entitlement, so a manual run of this case needs a tenant whose
> org plan carries it (e.g. `hub`, as in EDU-QZ-01…03/05) — on a `launch` org the autosave and
> „Zapisz” answer 403 and the plan card replaces the editor. The case has no spec, so nothing
> in the suite runs it automatically.

## Steps

1. Wprowadź zmianę i odczekaj kilka sekund.
2. W DevTools ustaw „Offline” i wprowadź kolejną zmianę.
3. Kliknij „Zapisz”.

## Expected result

- Po chwili toast „Zapisano”; przy błędzie sieci „Autozapis nieudany” / „Zapis nieudany”.
- Po przywróceniu sieci zapis ręczny przechodzi i wskaźnik „Niezapisane zmiany” znika.
- Odświeżenie strony po zapisie zachowuje zmiany.
