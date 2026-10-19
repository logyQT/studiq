# MGR-SEAT-02 — Przydzielenie miejsca członkowi

- id: MGR-SEAT-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Licencje / miejsca (/manage/seats)
- prereqs: MGR-SEAT-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Pula z MGR-SEAT-01.

## Prerequisite context

### MGR-SEAT-01 — Zakup miejsc (symulacja)
_Warunek wstępny: M1._
1. Kliknij „Kup miejsca”, wybierz plan i ilość 3, kliknij „Kup”.
2. Spróbuj ilości 0 oraz ujemnej.

Expected:
- Toast „Miejsca dodane do puli”; pula na liście ma 3 wykupione, 0 przydzielonych, 3 dostępne.
- Przycisk „Kup” jest nieaktywny bez planu lub przy ilości < 1.

## Steps

1. Kliknij „Przydziel miejsce”, wybierz członka i plan miejsca, kliknij „Przydziel”.
2. Sprawdź jego funkcje/limity po zalogowaniu.

## Expected result

- Toast „Miejsce przydzielone pomyślnie”; w „Przydziałach” nowy wpis; w puli przydzielone +1, dostępne −1.
- Członek otrzymuje funkcje/limity planu miejsca (np. dostęp do AI dla planu premium) – role administracyjne nie otrzymują funkcji wyłącznie-adminowych.
- Dostępne są tylko pule pasujące do poziomu (tier) członka.
