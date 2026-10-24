# STU-45 — Dostęp do AI zależny od planu

- id: STU-45
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Asystent AI (/app/ai)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto S1 (plan Base – bez ai.chat).

## Steps

1. Sprawdź menu boczne.
2. Wejdź ręcznie na /app/ai.

## Expected result

- Pozycja „Asystent Q” niewidoczna w menu dla planu Base.
- Bezpośrednie wejście na /app/ai: zanotuj zachowanie (strona może się wyświetlić; wywołania API powinny być ograniczone planem/limitem tokenów = 0).
