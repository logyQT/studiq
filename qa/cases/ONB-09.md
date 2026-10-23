# ONB-09 — /join – brak tokenu, zły token, wygasły token

- id: ONB-09
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Zaproszenie przez link (/join?token=…)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /join (bez parametru).
2. Otwórz /join?token=zlytoken.
3. Otwórz link zaproszenia, które zostało odwołane lub którego ważność (7 dni) minęła.

## Expected result

- Brak tokenu → natychmiastowe przekierowanie na /register.
- Zły token → toast z błędem i przekierowanie na /register.
- Odwołane/wygasłe zaproszenie → traktowane jak nieprawidłowe (przekierowanie, brak formularza).
