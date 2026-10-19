# STU-46 — Włączenie AI przez administratora (flaga/override)

- id: STU-46
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Asystent AI (/app/ai)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Dostęp do panelu admina (ADM-FLG, ADM-OVR).

## Steps

1. W panelu admina utwórz nadpisanie użytkownika (User Overrides) dla student1: ai.chat = włączone.
2. Odśwież /app jako student1.

## Expected result

- Pozycja „Asystent Q” pojawia się w menu; /app/ai działa.
- Po usunięciu nadpisania pozycja znika.
