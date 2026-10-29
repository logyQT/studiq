# NFR-08 — Zgodność przeglądarek

> **OUT OF SCOPE for qa-suite (2026-10-29).** This case asserts a relation _between_ browsers;
> the QA-suite runner is chromium-only by design. Cross-browser coverage lives in the e2e matrix
> (`__tests__/e2e`, firefox + webkit legs). Do not write a qa-suite spec and do not re-file.
> Issue #923 is closed as not planned.

- id: NFR-08
- priority: P2 ważny
- module: NFR – Wymagania niefunkcjonalne i międzyobszarowe
- section: Wydajność i stabilność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Chrome, Firefox, Edge (ostatnie wersje); opcjonalnie Safari.

## Steps

1. Wykonaj zestaw smoke (AUT-07, STU-05, STU-09, EDU-ASG-01, MGR-MEM-01) w każdej przeglądarce.

## Expected result

- Identyczne zachowanie i wygląd we wszystkich przeglądarkach; zanotuj różnice (np. selektor koloru, datetime-local, upload plików).
