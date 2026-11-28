# NFR-01 — Brakujące tłumaczenia – przegląd polskiej wersji

- id: NFR-01
- priority: P2 ważny
- module: NFR – Wymagania niefunkcjonalne i międzyobszarowe
- section: Język i motyw
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Język polski.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda. Przypadek potrzebuje wyłącznie polskiego
interfejsu i zawartości dla czterech modułów, więc wystarcza domyślny tenant `content`:

```bash
bun run env:run -- bun scripts/qa-tenant.ts NFR-01 --fresh
```

- Profil `content`, bez pliku profilu: organizacja `qa-nfr-01-<suffix>`, manager,
  nauczyciel, student i grupa domyślna `G1`. Spec czyta dane przez `loadTenant('NFR-01')`.
- Przebieg otwiera ekrany STU, EDU, MGR i BIL jako student, nauczyciel i manager, a
  następnie ekrany publiczne `/login` i `/pricing`.
- Ekran `/join` wymaga prawdziwego zaproszenia: spec tworzy je przez
  `POST /api/v1/organization/invites` w tym samym tenancie i usuwa je przez `DELETE` przed
  końcem przebiegu, więc nie zostawia wiersza.
- Spec nie czyta ani nie zapisuje wierszy globalnych: katalogu planów, flag funkcji,
  ustawień platformy ani statystyk singletonowych. Nazwy planów (`Free`, `Plus`) są
  dozwolone.

## Steps

1. Przejdź po wszystkich ekranach z modułów STU, EDU, MGR, BIL.
2. Szukaj surowych kluczy (np. RegisterPage.join_title, join_desc, activate_account), „undefined”, tekstów w obcym alfabecie lub angielskich w polskim UI.

## Expected result

- Brak surowych kluczy i fragmentów po angielsku (wyjątki: nazwy własne, plany Free/Plus/…).
- Wypisz znalezione miejsca (ekran, tekst) w uwagach lub zgłoszeniach – szczególnie ekran /join, przycisk „Back to plans” w checkout, nazwy kolumn.
