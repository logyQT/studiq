# STU-17 — Zawieszanie talii

- id: STU-17
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Własna talia z fiszkami.

## Steps

1. Wybierz „Zawieś talię”.
2. Sprawdź listę talii; włącz „Pokaż zawieszone”.
3. Rozpocznij sesję „Ucz się”.
4. Wybierz „Przywróć talię”.

## Expected result

- Toast „Talia zawieszona”; talia znika z domyślnej listy, widoczna z plakietką „Zawieszona” po włączeniu „Pokaż zawieszone”.
- W widoku talii komunikat „Ta talia jest zawieszona. Fiszki z tej talii nie będą wyświetlane w sesjach nauki ani statystykach.”.
- Fiszki zawieszonej talii nie pojawiają się w sesjach ani statystykach.
- Po „Przywróć talię” (toast „Talia przywrócona”) wracają do nauki.
