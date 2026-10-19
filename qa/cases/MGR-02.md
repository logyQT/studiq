# MGR-02 — Menu boczne managera

- id: MGR-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Pulpit managera
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany manager@dev.local.

## Steps

1. Kliknij każdą pozycję menu.

## Expected result

- Sekcje: Główne (Przegląd, Asystent Q), Administracja (Członkowie, Zaproszenia, Grupy, Zgłoszenia, Role, Licencje, Ustawienia).
- ZNANY PROBLEM: „Asystent Q” prowadzi do /manage/ai, którego nie ma w aplikacji (spodziewane 404); dodatkowo API AI nie jest dozwolone dla managera – zanotuj zachowanie.
