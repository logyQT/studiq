# STU-47 — Czat AI – podstawowa rozmowa

- id: STU-47
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Asystent AI (/app/ai)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

AI włączone; skonfigurowany LLM_API_KEY. Bez klucza oznacz N/D.

## Steps

1. Otwórz /app/ai. Kliknij podpowiedź „Wyjaśnij pojęcie” lub wpisz „Wyjaśnij pojęcie fotosyntezy”.
2. Wyślij („Wyślij”).
3. Kliknij „Zatrzymaj” w trakcie odpowiedzi (jeśli aktywne), a potem „Nowa rozmowa” i „Wyczyść czat”.

## Expected result

- Powitanie „Cześć … Jak mogę pomóc Ci w nauce?”, pole „Zapytaj Q”.
- Odpowiedź strumieniowana; widoczna ikona „Pokaż myślenie”.
- Na dole ostrzeżenie „Sztuczna inteligencja może popełniać błędy…”.
- Licznik „X/Y zapytań użytych dzisiaj” (jeśli skonfigurowany).
