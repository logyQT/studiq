# STU-19 — Import talii/fiszek z CSV (lista talii)

- id: STU-19
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Plik fiszki_poprawne.csv (folder Studiq_dane_testowe).

## Seed (tenant model, reconciled)

Automatyzacja nie używa kont z ręcznego seeda. Każde niezależne uruchomienie
dostaje własny, świeżo zaseedowany tenant:

```bash
bun scripts/qa-tenant.ts STU-19 --fresh
```

- Profil tenanta: `__tests__/qa/profiles/STU-19.json` = `"content"` — jedna
  organizacja, domyślna grupa `G1` oraz konta managera, nauczyciela i studenta.
- Klucz tenanta: `STU-19.md::STU-19#<run>::qa-shared` —
  `tenantKey('qa/cases/STU-19.md', 'STU-19#<run>', 'qa-shared')` + `tenantId`,
  ten sam schemat co fixture'y e2e. Hasło startowe `Seed4Test!`.
- Konto testowe to świeżo zaseedowany student tenanta; przed importem nie ma
  żadnej talii, więc lista talii jest deterministyczna („0 talii”).
- Plik `fiszki_poprawne.csv` nie jest częścią repozytorium, więc spec buduje
  równoważny plik w pamięci (12 poprawnych wierszy: `front`, `back`, `topic`)
  i wgrywa go przez pole pliku samego dialogu.
- Spec: `__tests__/qa/STU/STU-19.spec.ts`, `NEXT_LOCALE=pl` (dokument cytuje polskie
  napisy).
- Uwagi o dryfie UI (spacer po współdzielonej aplikacji, 2026-10-29):
  1. Przycisk na liście talii to „Importuj” (nie „Importuj CSV”); sam dialog ma
     tytuł „Importuj CSV”. Spec klika etykietę, która jest w produkcie.
  2. Krok 4 mówi „Wpisz nazwę talii (domyślnie «Zaimportowane Fiszki»)”, ale
     dialog nie ma pola nazwy — talia zawsze powstaje z domyślną nazwą
     „Zaimportowane Fiszki” (`imported_deck_default_name`). Oczekiwany rezultat
     (utworzona talia z wszystkimi fiszkami) jest spełniony, więc spec asertuje
     tę domyślną nazwę i nie koduje nieistniejącego pola.
  3. Kolumna „Talia” jest opcjonalna i w tym scenariuszu pozostaje
     niezmapowana — zgodnie z oczekiwanym rezultatem powstaje jedna talia.

## Steps

1. Na liście talii wybierz „Importuj CSV”.
2. Przeciągnij plik lub kliknij „Upuść plik CSV tutaj…”.
3. Zmapuj kolumny „Przód” (front), „Tył” (back), opcjonalnie „Temat” i „Talia”.
4. Wpisz nazwę talii (domyślnie „Zaimportowane Fiszki”) i kliknij „Importuj N fiszek”.

## Expected result

- Podgląd: „Znaleziono N wierszy” i „Wyświetlanie X z N wierszy”.
- Po imporcie „Import zakończony – Zaimportowano N z N fiszek”.
- Utworzona talia zawiera wszystkie fiszki z poprawnym przodem/tyłem i tematami.
