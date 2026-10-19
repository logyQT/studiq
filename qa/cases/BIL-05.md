# BIL-05 — Checkout – plan niezgodny z typem konta

- id: BIL-05
- priority: P1 krytyczny
- module: BIL – Plany, rozliczenia i płatność (symulowana)
- section: Zakup planu (checkout)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1.

## Steps

1. Ręcznie otwórz /checkout?plan_id=campus (plan organizacji) i dokończ płatność testową.

## Expected result

- ZANOTUJ I ZGŁOŚ jeśli się powiedzie: z kodu wynika brak weryfikacji, czy plan pasuje do typu konta – student może przypisać sobie plan organizacyjny/edukatora (potencjalnie nadając uprawnienia). Oczekiwane: odrzucenie zakupu planu niezgodnego z typem konta.
