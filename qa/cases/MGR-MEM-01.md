# MGR-MEM-01 — Lista członków – wyszukiwanie i filtr roli

- id: MGR-MEM-01
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Członkowie (/manage/members)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito.

## Steps

1. Otwórz /manage/members.
2. Wpisz „T1” w „Szukaj członków…”, potem e-mail student1.
3. Użyj „Filtruj po roli” – „Wszystkie role”, „Nauczyciel”, „Członek”.

## Expected result

- Tabela: Członek, Rola, Dołączył, Grupy, Akcje; licznik „N łącznie”.
- Wyszukiwanie po imieniu i e-mailu (bez wielkości liter); filtr roli zawęża listę.
- Przy własnym koncie adnotacja „(ty)”; brak imienia → „Bez imienia”.
