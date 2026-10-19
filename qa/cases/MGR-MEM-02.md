# MGR-MEM-02 — Zmiana roli członka

- id: MGR-MEM-02
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Członkowie (/manage/members)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito; członek S1 (rola Member).

## Steps

1. Wybierz akcję zmiany roli przy S1 i ustaw „Teacher”.
2. W oknie „Zmienić rolę?” potwierdź.
3. Odśwież stronę, a następnie przywróć rolę „Member”.

## Expected result

- Toast „Rola zaktualizowana”; rola w tabeli zmienia się.
- Zanotuj treść okna potwierdzenia – szablon „Czy na pewno chcesz zmienić {role}?” może wyświetlać niekompletne zdanie (uwaga językowa).
- Dostępne role to role organizacji (Admin / Teacher / Member + role niestandardowe).
