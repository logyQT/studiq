# ADM-PLN-03 — Edycja planu – typ konta i ceny

- id: ADM-PLN-03
- priority: P1 krytyczny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Plany subskrypcji (/subscription-plans)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Plan „test_plan”.

## Steps

1. Zmień typ konta na „Edukator”.
2. Wyczyść pole „Miesięcznie” i zapisz.
3. Zmień nazwę na 300 znaków i zapisz.

## Expected result

- Typ konta zmienia się i plan przenosi się do cennika edukatora.
- Pusta cena nie zeruje istniejącej wartości (pozostaje 1500), zmiany innych pól zapisują się.
- Zbyt długa nazwa → widoczny czerwony komunikat błędu w oknie (np. UNPROCESSABLE_ENTITY), formularz nie zamyka się cicho.
