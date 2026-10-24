# ADM-SEC-01 — API z kluczami – brak/niepoprawny podpis

- id: ADM-SEC-01
- priority: P2 ważny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Zabezpieczenie API panelu (PEM)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Klucz wygenerowany skryptem admin_podpisz_zadanie.mjs (folder Studiq_dane_testowe, polecenie: node admin_podpisz_zadanie.mjs gen); wartość ADMIN_PEM_KEYS wpisana do apps/admin/.env; admin zrestartowany.

## Steps

1. Wywołaj GET /api/v1/feature-flags bez nagłówków.
2. Dodaj nagłówki x-admin-signature i x-admin-timestamp z błędnym podpisem.
3. Użyj poprawnego podpisu ze starym znacznikiem czasu (> 5 minut).
4. Użyj poprawnego, świeżego podpisu (node admin_podpisz_zadanie.mjs GET /api/v1/feature-flags; warianty --bad-signature i --old-timestamp dla przypadków negatywnych).

## Expected result

- Brak nagłówków → 401 ERROR_UNAUTHORIZED.
- Zły podpis → 403 ERROR_FORBIDDEN.
- Stary znacznik → 401.
- Poprawny podpis → 200 z danymi.
