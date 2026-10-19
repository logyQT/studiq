# ADM-PLN-04 — Usunięcie planu

- id: ADM-PLN-04
- priority: P2 ważny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Plany subskrypcji (/subscription-plans)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Plan „test_plan” bez użytkowników.

## Steps

1. Usuń plan i potwierdź.
2. Spróbuj usunąć plan „base” (używany przez użytkowników).

## Expected result

- Plan testowy usunięty.
- Usunięcie planu w użyciu: oczekiwana blokada/błąd (zanotuj – ryzyko osieroconych profili).
