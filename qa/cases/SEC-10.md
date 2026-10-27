# SEC-10 — XSS w polach tekstowych

- id: SEC-10
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Walidacja wejścia i odporność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Dowolne konto z prawem tworzenia treści.

## Steps

1. Utwórz talię o nazwie <img src=x onerror=alert(1)>.
2. Utwórz fiszkę z treścią Markdown zawierającą <script>alert(1)</script> oraz [klik](<javascript:alert(1)>).
3. Wpisz skrypt w opisie grupy, nazwie bankowi, odpowiedzi w kartkówce i wiadomości zgłoszenia.
4. Wyświetl wszystkie te elementy (listy, podgląd, sesja nauki, widok nauczyciela).

## Expected result

- Treści wyświetlają się jako tekst; skrypty nie wykonują się; link javascript: nie jest aktywny.
- Brak okien alert().
