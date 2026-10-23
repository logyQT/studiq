# ADM-PLN-02 — Utworzenie planu z typem konta

- id: ADM-PLN-02
- priority: P1 krytyczny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Plany subskrypcji (/subscription-plans)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Panel admina.

## Steps

1. Kliknij „Utwórz plan”: klucz „test_plan”, nazwa „Plan testowy”, typ konta „Student”, cena miesięczna 1500, roczna 15000, kolejność 99.
2. Zapisz.
3. Sprawdź /pricing/student w aplikacji web.

## Expected result

- Plan pojawia się w tabeli z typem „Student” i cenami; pod polami cen widoczna podpowiedź „W groszach (100 = 1,00 zł)”.
- Plan widoczny w cenniku studenta (15,00 zł) – plan „Dowolny” bez typu zachowuje się zgodnie ze specyfikacją (zanotuj).
