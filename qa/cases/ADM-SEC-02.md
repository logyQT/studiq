# ADM-SEC-02 — Strony UI przy włączonym PEM

- id: ADM-SEC-02
- priority: P2 ważny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Zabezpieczenie API panelu (PEM)
- prereqs: ADM-SEC-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

ADM-SEC-01 skonfigurowane.

## Prerequisite context

### ADM-SEC-01 — API z kluczami – brak/niepoprawny podpis
_Warunek wstępny: Klucz wygenerowany skryptem admin_podpisz_zadanie.mjs (folder Studiq_dane_testowe, polecenie: node admin_podpisz_zadanie.mjs gen); wartość ADMIN_PEM_KEYS wpisana do apps/admin/.env; admin zrestartowany._
1. Wywołaj GET /api/v1/feature-flags bez nagłówków.
2. Dodaj nagłówki x-admin-signature i x-admin-timestamp z błędnym podpisem.
3. Użyj poprawnego podpisu ze starym znacznikiem czasu (> 5 minut).
4. Użyj poprawnego, świeżego podpisu (node admin_podpisz_zadanie.mjs GET /api/v1/feature-flags; warianty --bad-signature i --old-timestamp dla przypadków negatywnych).

Expected:
- Brak nagłówków → 401 ERROR_UNAUTHORIZED.
- Zły podpis → 403 ERROR_FORBIDDEN.
- Stary znacznik → 401.
- Poprawny podpis → 200 z danymi.

## Steps

1. Otwórz w przeglądarce /feature-flags.

## Expected result

- Strona UI ładuje się (UI nie jest chronione), ale zapytania danych przeglądarki do /api/* kończą się 401 – oczekiwane: pusta lista/błąd. To znana cecha projektu: panel działa z UI tylko w trybie bez kluczy lub za zaufanym proxy podpisującym żądania.
