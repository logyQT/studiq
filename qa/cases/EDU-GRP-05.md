# EDU-GRP-05 — Brak funkcji group.manage

- id: EDU-GRP-05
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Grupy nauczyciela (/edu/groups)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Wyłącz funkcję group.manage dla T1 w panelu admina (ADM-OVR) lub użyj konta bez tej funkcji.

## Steps

1. Odśwież panel nauczyciela.
2. Wejdź ręcznie na /edu/groups.

## Expected result

- Pozycja „Grupy” znika z menu.
- Operacje zapisu na grupach są odrzucane (403 FORBIDDEN) – brak niezabezpieczonych akcji.
