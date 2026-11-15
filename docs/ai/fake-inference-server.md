# Fake inference server for the AI suite

**Status:** implemented — phases 0 and 1 (engine, 12 fixtures, STU-47 and STU-48, the `ai-suite`
job). Phase 2 and the open items at the end remain. Where the build differs from the first draft
of this brief, the text below says what shipped.

**Why:** the AI QA cases are parked (#926) because the suite must never call a real model in
the merge gate. A replay server that speaks the OpenAI chat-completions wire format lets the
suite test how the app handles **bad model output** deterministically and offline.

**Verified against:** `ai@7.0.162`, `@ai-sdk/openai-compatible@3.0.84` (main, 2026-11-11),
by driving `streamText` against the engine across the wire behaviours below — see §5, where the
throwaway probe became a unit test.

---

## 1. What it is

One small Bun process that replays **per-case fixtures**:

```
request ──▶ matcher ──▶ ordered turn ──▶ SSE chunks + finish + fault
                                              │
                                          journal
```

It knows HTTP, SSE, the chat-completions schema, and a journal. It does **not** know what a
flashcard is, which tools the app registers, or what the UI should show. Every product-shaped
fact lives in a fixture file or the spec that asserts the outcome.

Two contracts stay separate on purpose:

| Layer       | Lives in                                                            | May contain                                                        | Must never contain                            |
| ----------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| **Engine**  | `scripts/fake-llm/{server,engine,stream,journal,fixtures,types}.ts` | HTTP, SSE, schema, matcher, faults, journal                        | tool names, "flashcard", "deck", expectations |
| **Fixture** | `scripts/fake-llm/cases/<CASE>.<slug>.json`                         | product tool names, argument payloads, prompt markers, card counts | assertions about the app                      |
| **Spec**    | `__tests__/qa/AI/<CASE>.spec.ts`                                    | navigation, expected DOM, DB/usage assertions                      | model-side detail it does not need            |

## 2. Engine contract

### Stack

Bun only, zero new dependencies. The repo already runs Bun as package manager, script runner and
task runner, and `scripts/load-test/` is the precedent: a multi-file Bun program with its own
README, npm scripts and a standalone process.

| Piece              | Choice                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server             | `FakeLlm.handle(Request): Response` over a manual `ReadableStream`; only `server.ts` calls `Bun.serve`, so the unit tests (Node) drive the engine without a socket |
| Runtime            | `bun scripts/fake-llm/server.ts` — TypeScript executed directly, no build step                                                                                     |
| Fixtures           | JSON via `node:fs` at boot; a hand-written validator rejects typos, empty matches and contradictory faults, naming the file and the path                           |
| Conversation key   | `node:crypto` `createHash('sha256')`                                                                                                                               |
| Faults             | `controller.error()` for resets, early `close()` for EOF cases                                                                                                     |
| Spec client        | `__tests__/qa/AI/fake-llm.ts` (`#test/qa/AI/fake-llm`): plain `fetch` parsed with zod, no SDK                                                                      |
| Dependencies added | none                                                                                                                                                               |
| Env                | none: port comes from `--port` (default 4321), not `process.env`                                                                                                   |

Three repo gates shaped this:

- `scripts/check-env-inventory.ts` requires every static `process.env.*` read under `scripts/`
  to be declared in `.env.schema`, so the server takes a CLI flag and declares nothing.
- The root `tsconfig.json` includes `**/*.ts` and `bun run typecheck:all` runs `bun check` at the
  root precisely because "it covers `scripts/`, which no workspace does" — so the engine is
  type-checked with no extra config.
- `knip` is a hard gate in both hooks and in the `checks` job, and it derives entries from
  `package.json` scripts and from `verify.yml` command lines. Starting the server through a
  `mock:llm` script (and referencing it in the workflow) keeps it an entry instead of an
  unused-file finding — the same reason `scripts/e2e-seed.ts` needs no knip entry.

It lives in `scripts/` rather than `qa/` because `qa/` is now the markdown case corpus — the
TypeScript fixtures moved to `__tests__/qa/` in #948.

|             |                                                                                    |
| ----------- | ---------------------------------------------------------------------------------- |
| Runtime     | `Bun.serve`, bound to `127.0.0.1` only, `--port` (default 4321)                    |
| Inference   | `POST /v1/chat/completions` — streaming **and** non-streaming                      |
| Ops         | `GET /v1/models`, `GET /healthz`                                                   |
| Control     | `POST /__admin/reset`, `GET /__admin/journal`, `GET /__admin/journal/:id`          |
| Later       | `PUT /__admin/scenarios/:key` (programmatic seeding, phase 2)                      |
| Journal     | per request: fixture key, turn, fault, request body, exact bytes written, duration |
| Determinism | fixed `chatcmpl-qa-<n>` ids, fixed `created`, fixed usage, no clock, no randomness |

### Scenario selection

No app change, no shared cursor:

```
fixture         = the most specific fixture whose `match` holds (a tie is an `ambiguous` error)
fixtureKey      = "<CASE>:<slug>"                          e.g. STU-48:truncated-args
conversationKey = sha256(firstUserMessage).slice(0, 16)     ← parallel isolation
turn            = counters[conversationKey][fixtureKey] ?? 0
response        = fixture.turns[min(turn, len - 1)]         ← last turn repeats
counters[conversationKey][fixtureKey] = turn + 1
```

The app sends one env-configured model name and no user id, so **request content is the only
per-test selector available without touching production code**. Each Playwright test types its
own message, so a conversation owns its counters. The reset (`POST /__admin/reset`, before every
test) and the journal are global to the server, so the `ai-suite` job runs with **one worker**: two
specs at once would erase each other's turn counters.

- `maxTurns` (default 40) exceeded → 500 + journal `overrun`. A runaway loop is a fixture bug,
  not a 30-step mystery.
- A `match` **inside** a turn is a guard, not a selector: mismatch → 500 + `turn-mismatch`.
- No fixture matches → 500 + `unmatched`; two fixtures that match equally well → `ambiguous`.
  Never a silent fallback.
- A request without tools (a nested call) gets **400** instead of 500 for any of the above: the
  SDK retries a 5xx three times, which would turn a fixture mistake into a 14 s wait.

### Matcher (wire-level fields only)

`firstUserContains`, `lastUserContains`, `systemContains`, `hasToolResult` (last message is
`role:"tool"`), `hasTools` (outer call vs nested), `messageCount`, `model`. The most specific
match (the most fields) wins. There is no `turn` field: the turn is the position in `turns`, and
a `match` inside a turn is a guard.

**Prefer `lastUserContains`.** A greeting chip puts a canned exchange („Wyjaśnij pojęcie” / „Jakie
pojęcie mam Ci wyjaśnić?”) into the history the model receives, so the _first_ user message is the
chip, not the question. The last user message stays the same through the tool loop (tool results
have the role `tool`).

### Faults — seven

| Fault                 | Shape                                            |
| --------------------- | ------------------------------------------------ |
| `http`                | `{ status: 400 \| 500, body: { error: { … } } }` |
| `truncateArgumentsAt` | byte offset into the serialized `arguments`      |
| `errorFrameAt`        | after N body frames → `data: {"error":{…}}`      |
| `closeWithoutFinish`  | drop `[DONE]` **and** `finish_reason`            |
| `omitDone`            | keep `finish_reason` and usage, drop `[DONE]`    |
| `destroyAfter`        | `controller.error()` after N frames              |
| `delay`               | `{ chunkMs, firstChunkMs }`                      |

`hangAfter` is deferred: the chat route sets no server-side timeout, so today the only thing it
can prove is a UI assertion, not a model-behaviour one.

## 3. Fixture contract

```jsonc
{
  "key": "STU-48:truncated-args",
  "case": "STU-48",
  "match": { "lastUserContains": "fiszki o planetach", "hasTools": true },
  "maxTurns": 4,
  "turns": [
    {
      "toolCalls": [
        {
          "id": "call_1",
          "name": "generate_flashcards",
          "arguments": "{\"task\":\"planety\",\"flashcards\":[{\"front\":\"Ile planet",
        },
      ],
      "truncateArgumentsAt": 46,
      "finish": "tool_calls",
    },
    { "match": { "hasToolResult": true }, "content": "Spróbuję inaczej.", "finish": "stop" },
  ],
}
```

Turn fields:

- `content` — string or `string[]` (each element becomes a chunk)
- `reasoning`
- `toolCalls[]` — `{ id, name, arguments }`, where **`arguments` may be an object or a raw
  string**; the raw string is how truncation and garbage are expressed
- `finish` — `stop | tool_calls | length | content_filter | error | null`; `null` sends `[DONE]`
  with no finish reason at all
- `usage` — `{ input, output }`; omit it to reproduce a provider that sends no usage
- `stream` — a guard on the request: the reply shape follows the request (`stream: true` gets SSE,
  anything else the JSON completion a nested call expects)
- `match` — guard for this turn
- faults from §2; at most one stream fault per turn, and the stream faults need a streaming request

A fixture file holds one fixture and is named `<CASE>.<slug>.json`. The loader validates every
file when the server boots and refuses to start on a typo, an empty `match` (it would catch every
request), a duplicate key or a contradictory fault, so a mistake never surfaces as an `unmatched`
failure far from the file that caused it.

## 4. Behaviour the fixtures must reproduce

| Behaviour                                 | Result                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `delta.role`                              | only `"assistant"` or `""`; anything else fails the provider chunk schema                                               |
| Arguments split across SSE deltas         | **succeeds** — must not be modelled as a fault                                                                          |
| Arguments truncated                       | `tool-call` (`invalid: true`) with the **raw string** as input, then `tool-error`; `execute` never runs                 |
| Unknown / hallucinated tool               | `tool-error`; the model may correct on the next step                                                                    |
| Extra object keys                         | stripped by Zod; the call succeeds                                                                                      |
| Wrong field types / missing required      | `tool-error`                                                                                                            |
| `[DONE]` missing, `finish_reason` present | **fine** — `[DONE]` is genuinely optional (`omitDone`)                                                                  |
| `finish_reason` missing                   | `InvalidResponseDataError: Response stream ended without a finish reason.` — with or without `[DONE]`                   |
| Connection destroyed mid-stream           | **thrown out of the stream iteration** as `AI_APICallError: Failed to process successful response`, not an `error` part |
| `{"error":{…}}` mid-stream                | `AI_StreamProviderError`, partial text kept, **no retry**                                                               |
| HTTP 5xx / 429                            | 3 attempts (2 s + 4 s), then one error part; `onFinish` never runs                                                      |
| 200 + empty body, or 200 + non-SSE JSON   | error part, `finishReason: "error"`                                                                                     |
| Usage chunk with `choices: []`            | captured — including **after** `finish_reason`                                                                          |
| No usage chunk                            | `totalUsage` is `{}` → the daily counter records 0                                                                      |
| Loop of valid calls                       | stops at `stepCountIs(30)`, `finishReason: "tool-calls"`, no error                                                      |

The last two matter beyond the harness: the provider never sends `stream_options.include_usage`
(verified in `dist/index.js:541,1075`), so **streaming turns currently meter zero tokens**, and
the nested `fetch_material` call is never metered at all. The usage fixtures are what make that
visible: the unit test pins the first, `STU-48` pins the second (a plan whose nested call reports
2 000 tokens moves the counter by the outer turns only).

### What building the suite showed about the product

Each is pinned or documented in the specs, and none is changed here. Issues
#1210–#1214 track the first five; the rest have no issue yet.

| Finding                                                                                                                                                                                                                                                   | Where                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| The thinking trace is a „Thought" toggle with a **hardcoded English** label; the Polish `thinking_title` is only used by a path that never renders — **#1210**                                                                                            | `chat-message.tsx` `ThoughtMessage`                    |
| `AiChatPage.status_thinking` / `status_generating` / `status_organizing` exist but nothing renders them; the case expects them — **#1211**                                                                                                                | `AiChatPage` messages                                  |
| The saved deck is named by the tool („Generated Flashcards", untranslated, when the model gives none); „AI Wygenerowane Fiszki" is only the fallback of the name field — **#1212**                                                                        | `generate-flashcards.tool.ts`, `flashcard-block.tsx`   |
| A streamed turn requests no usage from the provider, so a fully streamed answer can meter 0 tokens (#1213); the nested `fetch_material` call is never metered at all and is not covered by that issue                                                     | `packages/server/src/ai/model.ts`, `use-ai-chat.ts`    |
| The greeting chips are canned local replies that still become part of the history sent to the model — **#1214**                                                                                                                                           | `ai-chat-screen.tsx` `handleSuggestion`                |
| The Execution Plan block never progresses: the badge stays `0 / N completed` and `All steps complete` is unreachable, because the completed-step set lives on the message that created the plan and later tool results never reach it                     | `plan-block.tsx`, `use-ai-chat.ts`                     |
| A stopped answer meters 0 tokens: the Stop probe in STU-47 measured `1280 → 1280`                                                                                                                                                                         | `use-ai-chat.ts` (`stop`)                              |
| The plan, tool and result labels are hardcoded English: `Execution Plan (N steps)`, `N / M completed`, `All steps complete`, `Generated N characters of material`, `Found N key concepts`, `Summary ready` / `Quiz questions ready` / `Explanation ready` | `plan-block.tsx`, `use-ai-chat.ts`, `chat-message.tsx` |
| The flashcard preview shows `(N removed)` untranslated                                                                                                                                                                                                    | `flashcard-block.tsx`                                  |
| The AI chat copy has no Polish plural forms („Wygenerowano 4 fiszek"); the preview and save strings fixed here still sit beside `flashcards_preview` and `flashcard_deck_created`, which do not inflect („z 1 fiszkami")                                  | `apps/web/src/i18n/messages/pl.json`                   |
| A tool call with truncated or unknown input is fed back to the model as a tool error and has no UI                                                                                                                                                        | `use-ai-chat.ts`                                       |
| The counter is in tokens; the case document says „zapytań" (requests)                                                                                                                                                                                     | `usage-badge.tsx`                                      |

## 5. How this was validated

A throwaway probe drove `streamText` against a stub SSE server through 12 cases. It is now a
committed test: `__tests__/unit/qa/fake-llm-sdk.test.ts` imports the app's own model factory
(`@studiq/server/ai/model`, with `fetch` routed to the engine) and asserts what the client makes
of each wire behaviour the fixtures rely on — text and usage, reasoning, a valid and a truncated
tool call, an unknown tool, wrong and missing arguments, a stream with and without `[DONE]` or a
finish reason, a mid-stream error, a destroyed connection, an HTTP 400 and 500, the step cap and
a nested non-streaming call. A future SDK upgrade is answered by that test failing, not by an
opinion.

Running it on `ai@6.0.283` and on `ai@7.0.162` produced **one line of difference**: the
mid-stream provider error gained the name `AI_StreamProviderError`. Parts, ordering, step
counts, request counts, usage capture and the dirty-EOF error are identical — including that
v7's new `interrupted` finish reason does **not** appear on the openai-compatible path.

Because the test runs in the `unit` job, a behaviour change in a bump shows up there before it
shows up in a Playwright spec.

## 6. Purity rule, enforced

`__tests__/unit/qa/fake-llm-contract.test.ts` reads the engine sources and fails if they match:

```
/flashcard|deck|quiz|create_plan|fetch_material|extract_concepts|evaluate_quality|ask_user/
```

The match is case-insensitive and covers every engine file (`server`, `engine`, `stream`,
`journal`, `fixtures`, `types`). Vitest only collects `__tests__/{unit,integration}/**/*.test.ts`,
which is why the guard cannot live beside the engine. `scripts/**` has no import alias, so the
unit tests load the engine by file URL (the way the `scripts/env` tests do); specs import the
client as `#test/qa/AI/fake-llm`.

## 7. Test and CI wiring

|                  |                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixtures         | `scripts/fake-llm/cases/<CASE>.<slug>.json`, loaded at boot (`--fixtures <dir>` overrides)                                                                                                                                                    |
| Specs            | `__tests__/qa/AI/{STU-47,STU-48}.spec.ts` and the client `__tests__/qa/AI/fake-llm.ts` (`#test/qa/AI/fake-llm`)                                                                                                                               |
| Reset            | `POST /__admin/reset` in `beforeEach` — fixtures must be stateless across retries                                                                                                                                                             |
| CI               | dedicated **`ai-suite`** job, not a QA shard: its app process needs `LLM_BASE_URL`                                                                                                                                                            |
| Job env          | exported to `$GITHUB_ENV` like the other legs — there is no `apps/web/.env` any more; root `.env.local` is local-only                                                                                                                         |
| `LLM_*`          | `LLM_BASE_URL=http://127.0.0.1:4321/v1`, `LLM_API_KEY=qa-fake-key`, `LLM_MODEL_NAME=qa-fake` — all already in `.env.schema`                                                                                                                   |
| App posture      | `APP_ENV=qa`, `PAYMENT_DRIVER=mock`, matching the QA shards                                                                                                                                                                                   |
| App start        | `next start -p 3010 --keepAliveTimeout 55000` — the flag every runner must pass when it skips `apps/web`'s `start` script                                                                                                                     |
| Order            | `/healthz` check **before** the app starts — otherwise the app retries 3× per call and fails with a generic message                                                                                                                           |
| Workers          | **one** — `reset` and the journal are global to the server (the first draft said `QA_WORKERS=2`)                                                                                                                                              |
| Seeding          | `bun scripts/qa-tenant.ts --all --areas AI --run ci<run id>`: the area is the directory, each spec gets its tenant and one per retry                                                                                                          |
| Tenant           | `content` profile on the `hub` plan (`__tests__/qa/profiles/STU-47.json`, `STU-48.json`): a finite 200 000-token daily budget, so the counter can be asserted                                                                                 |
| Router           | `scope.ai_suite` is true for the AI files, the code the chat is made of, `package.json`/lockfile/workflow, and every nightly or dispatch run. The AI files alone never start a `qa-suite` shard (an unknown area used to mean "run all four") |
| Outside the gate | **not built:** nightly, `continue-on-error`, key-gated real-provider smoke asserting the happy path only                                                                                                                                      |

`model.ts` reads `LLM_*` at import time, so the env must be set before the build and before
`next start` — the same constraint the QA job already follows for Supabase. The job sets
`LLM_PROVIDER=fake` as well, so the model client is named for what it is talking to.

Locally, put the four values in root `.env.local` (`LLM_PROVIDER=fake`, `LLM_API_KEY=qa-fake-key`,
`LLM_MODEL_NAME=qa-fake`, `LLM_BASE_URL=http://127.0.0.1:4321/v1`), start the server, then the
stack, then the specs. The app runs from a production build, never `next dev`:

```bash
bun run mock:llm                              # fake model on 127.0.0.1:4321
bun run env:ensure --profile web              # add --runtime docker on Windows
bun scripts/qa-tenant.ts --all --areas AI --fresh
bun run test:qa __tests__/qa/AI               # QA_APP_URL must be the app URL, e.g. :3000
```

## 8. Decisions

| Topic                       | Decision                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Text instead of a tool call | assert today's behaviour — text rendered, zero cards, zero decks; no app change                                                  |
| Malformed tool call         | no app-side retry; rely on the SDK feeding the error back; assert the step count                                                 |
| Happy path                  | two baselines: direct `generate_flashcards` → `finish`, and plan → `fetch_material` → `extract_concepts` → cards → `finish`      |
| Schema strictness           | mirror Zod exactly — strip extras, reject wrong types, `count` never enforced                                                    |
| First cases                 | `STU-48` + `STU-47` (`STU-45`/`46`/`SEC-07` need no inference)                                                                   |
| Usage / rate limit          | usage assertions yes, rate limit no                                                                                              |
| Loop / step cap             | assert the silent stop plus a bounded request count                                                                              |
| Scenario selection          | conversation content, zero app change                                                                                            |
| Fixtures                    | JSON files in the repo                                                                                                           |
| CI vs manual QA             | both, same script                                                                                                                |
| Record / replay             | none — a cassette cannot record a broken stream as broken                                                                        |
| Nested inference            | first-class turn matched by `hasTools:false` + `systemContains`; fail fast with 400, not 500 (the nested call retries 3× ≈ 14 s) |
| Fault ownership             | engine-owned, in-process; no TCP proxy                                                                                           |
| MVP fault set               | the seven in §2 (`omitDone` was added so the "`[DONE]` is optional" row of §4 is covered by a test)                              |
| Fixture match               | the **last** user message, not the first (greeting chips put a canned exchange into the history)                                 |
| Parallelism                 | none: one worker, because the reset and the journal are global                                                                   |

## 9. Scope

Delivered:

```
scripts/fake-llm/     server, engine, stream, journal,         ≈ 980 LOC
                      fixtures (loader + validator), types
                      cases/*.json                             12 fixtures
__tests__/qa/AI/      STU-47.spec.ts (2 tests),                360 LOC, 11 tests
                      STU-48.spec.ts (9 tests), fake-llm.ts
__tests__/unit/qa/    purity, engine, fixture validation,      ≈ 890 LOC, 66 tests
                      app model client on ai@7
package.json          "mock:llm": "bun scripts/fake-llm/server.ts"
.github/workflows/    ai-suite job + the `scope.ai_suite` router output
```

**Phase 0 and 1: done.** Engine, matcher, ordered turns, `maxTurns`, seven faults, journal, 12
fixtures, two specs, CI job, router.

**Phase 2 (open):** `hangAfter`, the `PUT /__admin/scenarios/:key` control API, a nested-failure
fixture, `EDU-DECK-05`, the nightly real-provider smoke, and turning the findings in §4 into
issues.

## 10. Open items

1. **`interrupted`** — v7 defines it, but the openai-compatible path does not emit it (§5). If
   a future provider adapter starts emitting it, the fixture `finish` enum and one taxonomy row
   change; nothing structural.
2. **Streaming token accounting** — should the provider opt into `includeUsage`, or should the
   fake server always send a usage chunk so the counter is exercised? Product decision, and the
   fixtures work either way.
3. **Where the engine lives long-term** — it shipped in `scripts/fake-llm/`, with its client in
   `__tests__/qa/AI/`; the first draft said `qa/`, which is the markdown case corpus.
4. **Parallelism** — one worker is enough for 11 tests. If the suite grows, scope `reset` and the
   journal by case (`?case=STU-48`) instead of raising the worker count.
5. **The new AI epics** (#658-#661 and their parts #1147-#1157) each add a fixture and a spec;
   none needs an engine change unless it needs a fault this list does not have.
