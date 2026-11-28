# EDU-DECK-05 — Przycisk „Twórz z Agentem” (AI)

- id: EDU-DECK-05
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Talie i fiszki nauczyciela
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

AI włączone dla T1 (płatny plan osobisty Plus/Pro/Max lub override ai.chat).

## Seed (model tenanta)

Scenariusz jest odtwarzany we **własnym tenancie** przypadku, nie na kontach legacy
(`teacher1@dev.local`, `student1`, hasło `pass`). Każde uruchomienie ma świeży suffix:

- `tenantKey('qa/cases/EDU-DECK-05.md', 'EDU-DECK-05#<run>', 'qa-shared')` →
  `tenantId(key, …)` dla organizacji, grupy i kont;
- organizacja `qa-edu-deck-05-<run>` na planie `hub`: plan organizacji to wyłącznie
  pojemność (#1493), więc `ai.chat` nauczyciela pochodzi z jego planu osobistego
  `plus` (`personalPlan: "plus"`, `personalRole: "teacher"` w
  `__tests__/qa/profiles/EDU-DECK-05.json`);
- menedżer nie ma planu osobistego (ADR-0007), więc w tej samej organizacji nie ma
  `ai.chat` — to konto bez uprawnień do AI dla drugiego wyniku przypadku;
- talia powstaje przez `POST /api/v1/flashcards/decks` w tym tenancie, a modelem
  jest serwer zastępczy (`bun run mock:llm`, fixture
  `scripts/fake-llm/cases/EDU-DECK-05.deck-generate.json`) — żaden prawdziwy
  dostawca nie jest wywoływany.

Nic globalnego nie jest czytane ani zapisywane: żadne ustawienie admina, flaga
funkcji, plan globalny, statystyka platformy ani wiersz singletonu.

## Steps

1. W widoku talii kliknij „Twórz z Agentem”.
2. Wygeneruj fiszki i zapisz je do talii.

## Expected result

- Otwiera się generator/Asystent z kontekstem talii; wygenerowane fiszki można zapisać do bieżącej talii.
- Bez uprawnień do AI przycisk jest ukryty lub prowadzi do komunikatu o planie (zanotuj).
