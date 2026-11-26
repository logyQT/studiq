# STU-20 — Import CSV – błędne dane

- id: STU-20
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Pliki fiszki_bledne.csv oraz plik tekstowy nie-CSV.

## Steps

1. Wczytaj fiszki_bledne.csv (wiersze bez „back”, puste, ze znakami specjalnymi).
2. Spróbuj zaimportować bez mapowania kolumn.
3. Wczytaj plik .txt/.png zamiast CSV.

## Expected result

- Błędy w podsumowaniu: „N wierszy z błędami” z numerem wiersza i opisem („Wiersz / Błąd”); poprawne wiersze zostają zaimportowane.
- Bez mapowania: „Proszę przypisać kolumny Przód i Tył”.
- Zły typ pliku: „Nie udało się sparsować pliku CSV” (bez awarii).

## Reconciliation (#888)

- Spec: `__tests__/qa/STU/STU-20.spec.ts`; tenant profile `content`
  (`__tests__/qa/profiles/STU-20.json`), signed in as the student.
- Good rows are imported. The heading „N wierszy z błędami” counts each bad row one time.
  The list shows each problem with „Wiersz” and „Błąd” (the column's name and the reason).
  With no good row, the title is „Import nie powiódł się”, not „Import zakończony”. „Wiersz” is the „#” of the preview:
  the header is not counted, and a blank line between rows is a row of its own.
- „Bez mapowania”: the front and back pickers have a „—” option.
- A non-CSV file is refused the same way when picked and when dropped. The check is
  the `.csv` extension or the `text/csv` type; the content is not sniffed.
- One import takes at most 500 rows. A longer file shows its real row count and the
  general validation message with the count and the limit (for example „501 / 500”), and
  cannot be sent.
- The import counts its valid rows against the plan's `max_flashcards` and is
  refused as a whole past it.
