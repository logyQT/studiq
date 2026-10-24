# ADM-USR-06 — Trwałe usunięcie

- id: ADM-USR-06
- priority: P2 ważny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Użytkownicy (/users) – pełne zarządzanie z 30-dniowym koszem
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Użytkownik w koszu.

## Steps

1. Kliknij „Usuń trwale teraz”, potwierdź.
2. Spróbuj zalogować się usuniętym kontem.

## Expected result

- Okno ostrzega, że usuwanie jest natychmiastowe i nieodwracalne (obejmuje członkostwa i treści).
- Konto znika z listy; logowanie kończy się „Nieprawidłowy adres e-mail lub hasło.” (konto nie istnieje).
- Przycisk trwałego usunięcia nie jest dostępny dla aktywnych kont (tylko w koszu).
