# ADM-FLG-02 — Utworzenie flagi

- id: ADM-FLG-02
- priority: P1 krytyczny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Flagi funkcji (/feature-flags)
- prereqs: ADM-FLG-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

ADM-FLG-01.

## Prerequisite context

### ADM-FLG-01 — Lista flag
_Warunek wstępny: Baza po resecie._
1. Otwórz /feature-flags.

Expected:
- Tabela: Klucz, Nazwa, Opis, Włączona, Wdrożenie %, Akcje; flagi: group.manage, member.manage, role.builder, branding + pozostałe z migracji.
- Pusta baza: „Brak flag funkcji.”

## Steps

1. Kliknij „Utwórz flagę”.
2. Wpisz klucz „test.flag”, nazwę „Flaga testowa”, opis, wdrożenie 50, włącz „Włączona”.
3. Zapisz.

## Expected result

- Flaga pojawia się na liście z wartościami z formularza.
