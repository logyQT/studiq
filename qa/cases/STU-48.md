# STU-48 — Czat AI – generowanie fiszek i zapis do talii

- id: STU-48
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Asystent AI (/app/ai)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

AI włączone.

## Seed (QA-suite)

- Not a shard case: it runs in the `ai-suite` job (`__tests__/qa/AI/STU-48.spec.ts`)
  against the fake inference server (`bun run mock:llm`). Besides the documented
  flow it covers what a model sometimes does wrong: truncated or unknown tool
  calls, prose instead of a tool call, a runaway tool loop (capped at 30 steps), a
  stream that breaks, a cut connection and a provider that is down.
- Tenant: `bun scripts/qa-tenant.ts STU-48 --fresh` (`content` on the `hub` plan).
  The spec signs in as the tenant's `users.student`.
- The model's answers are the fixtures `scripts/fake-llm/cases/STU-48.*.json`.
- UI notes (walk 2026-11-15): the statuses „Analizuję tematy… / Generuję fiszki… /
  Organizuję w talie…" exist as messages but no component renders them, so they are
  not asserted. The deck is named by the generation tool („Generated Flashcards"
  when the model gives no name); „AI Wygenerowane Fiszki" is only the fallback of the
  name field, so the spec asserts the name the fixture chose.

## Steps

1. Wpisz „Stwórz 5 fiszek o układzie słonecznym”.
2. Po wygenerowaniu usuń jedną kartę („Usuń kartę”), jedną zachowaj.
3. Kliknij „Zapisz N fiszek jako talię”, następnie „Otwórz talię”.

## Expected result

- Statusy „Analizuję tematy… / Generuję fiszki… / Organizuję w talie…”.
- Podgląd kart z możliwością odrzucania/zachowania; toast „Talia utworzona z N fiszkami”.
- Talia „AI Wygenerowane Fiszki” istnieje z wybraną liczbą fiszek.
