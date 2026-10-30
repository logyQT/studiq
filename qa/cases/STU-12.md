# STU-12 — Historia quizów

- id: STU-12
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Quiz „Sprawdź się”
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Po kilku quizach.

## Seed (tenant model, reconciled)

Automatyzacja nie używa kont z ręcznego seeda. Każde niezależne uruchomienie
dostaje własny, świeżo zaseedowany tenant:

```bash
bun scripts/qa-tenant.ts STU-12 --fresh
```

- Profil tenanta: `__tests__/qa/profiles/STU-12.json` = `"content"` — jedna
  organizacja, domyślna grupa `G1` oraz konta managera, nauczyciela i studenta.
- Klucz tenanta: `STU-12.md::STU-12#<run>::qa-shared` —
  `tenantKey('qa/cases/STU-12.md', 'STU-12#<run>', 'qa-shared')` + `tenantId`,
  ten sam schemat co fixture'y e2e.
- „Konto TS bez quizów” to świeżo zaseedowany student tenanta (konto bez żadnej
  próby quizu). Prerekwizyt „po kilku quizach” spec tworzy sam, przez API
  produktu: bank pytań + jedno pytanie, jedna ukończona próba (1/1) i jedna
  rozpoczęta, niezakończona. Hasło startowe `Seed4Test!`.
- Spec: `__tests__/qa/STU/STU-12.spec.ts`, `NEXT_LOCALE=pl` (dokument cytuje polskie
  napisy).
- Uwaga o dryfie UI (spacer po współdzielonej aplikacji, 2026-10-28): oczekiwany
  rezultat powyżej opisuje karty quizów sprzed konsolidacji centrum statystyk
  (commit 2e265cfa usunął kafelek „Test praktyczny” z akcją „Wznów”). Aktualny,
  zamierzony ekran — potwierdzony przez STU-10/STU-11 oraz zamknięte zgłoszenia
  #324/#350/#351 — to karta „Ostatnie quizy” (wynik, data, „Przejrzyj”), banner
  „Quiz w trakcie” („Kontynuuj”/„Anuluj”) i „Zobacz pełną historię” → „Wyniki”
  z tabelą „Historia testów” („Podejście”, wynik %, data). Spec asertuje ten
  ekran, a nie usunięte etykiety.

## Steps

1. Otwórz zakładkę „Historia” i „Zobacz pełną historię”.
2. Sprawdź konto TS bez quizów.

## Expected result

- Lista prób z wynikiem, datą i typem („Test praktyczny”), stanem „W trakcie”/ukończony, akcjami „Przejrzyj”/„Wznów”.
- Konto bez historii: „Brak historii quizów – Rozwiąż quiz, aby zobaczyć swoją historię”.
