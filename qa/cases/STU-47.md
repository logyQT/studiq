# STU-47 — Czat AI – podstawowa rozmowa

- id: STU-47
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Asystent AI (/app/ai)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

AI włączone; skonfigurowany LLM_API_KEY. Bez klucza oznacz N/D.

## Seed (QA-suite)

- Not a shard case: it runs in the `ai-suite` job (`__tests__/qa/AI/STU-47.spec.ts`)
  against the fake inference server, so there no `LLM_API_KEY` is needed. A manual run
  without a key and without the fake server is still `N/D` (above). To run it locally:
  `bun run mock:llm` with the `LLM_*` values of `docs/ai/fake-inference-server.md` in
  root `.env.local`.
- Tenant: `bun scripts/qa-tenant.ts STU-47 --fresh` (`__tests__/qa/profiles/STU-47.json`
  → `content` on the `hub` plan with `personalPlan: "plus"`: the organization plan is
  capacity only, so the student's personal Plus plan carries `ai.chat` and its finite
  daily budget of 100 000 tokens). The spec signs in as the tenant's `users.student`.
- The model's answers are the fixtures `scripts/fake-llm/cases/STU-47.*.json`.
- UI notes (walk 2026-11-15): the counter reads „X/Y tokenów AI wykorzystanych
  dzisiaj" (tokens, not requests); „Wyjaśnij pojęcie" on the greeting is a canned
  local reply and the model is only asked once the user sends the question; the
  model's reasoning stays server-side, so there is no „Pokaż myślenie" toggle.

## Steps

1. Otwórz /app/ai. Kliknij podpowiedź „Wyjaśnij pojęcie” lub wpisz „Wyjaśnij pojęcie fotosyntezy”.
2. Wyślij („Wyślij”).
3. Kliknij „Zatrzymaj” w trakcie odpowiedzi (jeśli aktywne), a potem „Nowa rozmowa” i „Wyczyść czat”.

## Expected result

- Powitanie „Cześć … Jak mogę pomóc Ci w nauce?”, pole „Zapytaj Q”.
- Odpowiedź strumieniowana; rozumowanie modelu pozostaje ukryte.
- Na dole ostrzeżenie „Sztuczna inteligencja może popełniać błędy…”.
- Licznik „X/Y zapytań użytych dzisiaj” (jeśli skonfigurowany).
