# ADM-USR-04 — Usunięcie użytkownika (kosz 30 dni)

- id: ADM-USR-04
- priority: P1 krytyczny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Użytkownicy (/users) – pełne zarządzanie z 30-dniowym koszem
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Użytkownik created@example.com.

## Steps

1. Kliknij „Usuń”, w oknie „Usuń użytkownika” potwierdź.
2. Przejdź do zakładki „Usunięci”.
3. Spróbuj zalogować się usuniętym kontem w aplikacji web.

## Expected result

- Okno: „… zostanie natychmiast wylogowany i przeniesiony do Usuniętych. Zostanie trwale skasowany za 30 dni, chyba że zostanie przywrócony.”
- Użytkownik w zakładce „Usunięci” z kolumną „Trwałe usunięcie za” (ok. 30 dni).
- Logowanie odrzucone (konto zablokowane – komunikat o zbanowaniu/odmowie).
