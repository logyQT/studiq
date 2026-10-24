# MGR-ROL-01 — Tworzenie roli – plan bez role.builder (Launch)

- id: MGR-ROL-01
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Role (/manage/roles)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito (Launch).

## Steps

1. Kliknij „Nowa rola”, nazwa „Asystent”, opis; zapisz.

## Expected result

- Operacja odrzucona (403 – brak funkcji role.builder na planie Launch); toast „Nie udało się utworzyć roli”. Zanotuj: czy UI informuje o konieczności zmiany planu (UWAGA: strona nie wyświetla blokady z góry, jak w Ustawieniach).
