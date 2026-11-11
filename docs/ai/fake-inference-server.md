# Fake inference server for the AI suite

**Status:** design brief, not implemented. Review target — expand in place as decisions land.

**Why:** the AI QA cases are parked (#926) because the suite must never call a real model in
the merge gate. A replay server that speaks the OpenAI chat-completions wire format lets the
suite test how the app handles **bad model output** deterministically and offline.

**Verified against:** `ai@7.0.162`, `@ai-sdk/openai-compatible@3.0.84` (main, 2026-11-11),
by driving `streamText` against a throwaway SSE server across 12 cases — see §5.

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

| Layer       | Lives in                                        | May contain                                                        | Must never contain                            |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| **Engine**  | `qa/fake-llm/{server,engine,stream,journal}.ts` | HTTP, SSE, schema, matcher, faults, journal                        | tool names, "flashcard", "deck", expectations |
| **Fixture** | `qa/fake-llm/cases/<CASE>.json`                 | product tool names, argument payloads, prompt markers, card counts | assertions about the app                      |
| **Spec**    | `__tests__/qa/AI/<CASE>.spec.ts`                | navigation, expected DOM, DB/usage assertions                      | model-side detail it does not need            |

## 2. Engine contract

|             |                                                                                    |
| ----------- | ---------------------------------------------------------------------------------- |
| Runtime     | `Bun.serve`, bound to `127.0.0.1` only, `FAKE_LLM_PORT` (default 4321)             |
| Inference   | `POST /v1/chat/completions` — streaming **and** non-streaming                      |
| Ops         | `GET /v1/models`, `GET /healthz`                                                   |
| Control     | `POST /__admin/reset`, `GET /__admin/journal`, `GET /__admin/journal/:id`          |
| Later       | `PUT /__admin/scenarios/:key` (programmatic seeding, phase 2)                      |
| Journal     | per request: fixture key, turn, fault, request body, exact bytes written, duration |
| Determinism | fixed `chatcmpl-qa-<n>` ids, fixed `created`, fixed usage, no clock, no randomness |

### Scenario selection

No app change, no shared cursor:

```
fixtureKey      = "<CASE>:<slug>"                          e.g. STU-48:truncated-args
conversationKey = sha256(firstUserMessage).slice(0, 16)     ← parallel isolation
turn            = counters[conversationKey][fixtureKey] ?? 0
response        = fixture.turns[min(turn, len - 1)]         ← last turn repeats
counters[conversationKey][fixtureKey] = turn + 1
```

The app sends one env-configured model name and no user id, so **request content is the only
per-test selector available without touching production code**. Each Playwright test types its
own first message, so each owns its counters and workers cannot collide.

- `maxTurns` (default 40) exceeded → 500 + journal `overrun`. A runaway loop is a fixture bug,
  not a 30-step mystery.
- A `match` **inside** a turn is a guard, not a selector: mismatch → 500 + `turn-mismatch`.
- No fixture matches → 500 + `unmatched`. Never a silent fallback.

### Matcher (wire-level fields only)

`firstUserContains`, `lastUserContains`, `systemContains`, `hasToolResult` (last message is
`role:"tool"`), `hasTools` (outer call vs nested), `turn`, `messageCount`, `model`. Most
specific wins; `turn` beats no `turn`.

### Faults — six in the MVP

| Fault                 | Shape                                            |
| --------------------- | ------------------------------------------------ |
| `http`                | `{ status: 400 \| 500, body: { error: { … } } }` |
| `truncateArgumentsAt` | byte offset into the serialized `arguments`      |
| `errorFrameAt`        | chunk index → `data: {"error":{…}}`              |
| `closeWithoutFinish`  | drop `[DONE]` **and** `finish_reason`            |
| `destroyAfter`        | `controller.error()` after N chunks              |
| `delay`               | `{ chunkMs, firstChunkMs }`                      |

`hangAfter` is deferred: the chat route sets no server-side timeout, so today the only thing it
can prove is a UI assertion, not a model-behaviour one.

## 3. Fixture contract

```jsonc
{
  "key": "STU-48:truncated-args",
  "case": "STU-48",
  "match": { "lastUserContains": "fiszki o planetach", "turn": 0 },
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
- `finish` — `stop | tool_calls | length | content_filter | error | null`
- `usage` — `{ input, output }`; omit it to reproduce a provider that sends no usage
- `stream` — default `true`; `false` serves the non-streaming JSON shape (nested calls)
- `match` — guard for this turn
- faults from §2

## 4. Behaviour the fixtures must reproduce

| Behaviour                                 | Result                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `delta.role`                              | only `"assistant"` or `""`; anything else fails the provider chunk schema             |
| Arguments split across SSE deltas         | **succeeds** — must not be modelled as a fault                                        |
| Arguments truncated                       | `tool-call` with the **raw string** as input, then `tool-error`; `execute` never runs |
| Unknown / hallucinated tool               | `tool-error`; the model may correct on the next step                                  |
| Extra object keys                         | stripped by Zod; the call succeeds                                                    |
| Wrong field types / missing required      | `tool-error`                                                                          |
| `[DONE]` missing, `finish_reason` present | **fine** — `[DONE]` is genuinely optional                                             |
| `finish_reason` missing                   | `InvalidResponseDataError: Response stream ended without a finish reason.`            |
| `{"error":{…}}` mid-stream                | `AI_StreamProviderError`, partial text kept, **no retry**                             |
| HTTP 5xx / 429                            | 3 attempts (2 s + 4 s), then one error part; `onFinish` never runs                    |
| 200 + empty body, or 200 + non-SSE JSON   | error part, `finishReason: "error"`                                                   |
| Usage chunk with `choices: []`            | captured — including **after** `finish_reason`                                        |
| No usage chunk                            | `totalUsage` is `{}` → the daily counter records 0                                    |
| Loop of valid calls                       | stops at `stepCountIs(30)`, `finishReason: "tool-calls"`, no error                    |

The last two matter beyond the harness: the provider never sends `stream_options.include_usage`
(verified in `dist/index.js:541,1075`), so **streaming turns currently meter zero tokens**, and
the nested `fetch_material` call is never metered at all. The usage fixtures are what make that
visible.

## 5. How this was validated

A throwaway probe (`.dev/ai-probe/probe.ts`, gitignored) starts an in-process SSE server on an
ephemeral port and drives `streamText` through 12 cases: text, usage, length, valid tool call,
truncated call, unknown tool, clean EOF, dirty EOF, mid-stream error, malformed frame, empty
200, HTTP 500. It writes a normalised JSON snapshot, so a future SDK upgrade is answered by a
diff instead of an opinion.

Running it on `ai@6.0.283` and on `ai@7.0.162` produced **one line of difference**: the
mid-stream provider error gained the name `AI_StreamProviderError`. Parts, ordering, step
counts, request counts, usage capture and the dirty-EOF error are identical — including that
v7's new `interrupted` finish reason does **not** appear on the openai-compatible path.

That probe is also the reference for the fixtures: any behaviour change in a future bump shows
up in the snapshot before it shows up in a spec.

## 6. Purity rule, enforced

`__tests__/unit/qa/fake-llm-contract.test.ts` reads the engine sources and fails if they match:

```
/flashcard|deck|quiz|create_plan|fetch_material|extract_concepts|evaluate_quality|ask_user/
```

Vitest only collects `__tests__/{unit,integration}/**/*.test.ts`, which is why the guard cannot
live beside the engine. Engine files use relative imports (like `packages/*`); specs use
`@qa/...`, declared in `tsconfig.json` and honoured by Playwright.

## 7. Test and CI wiring

|                  |                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| Fixtures         | `qa/fake-llm/cases/*.json`, loaded at boot via `--fixtures`                                                         |
| Specs            | `__tests__/qa/AI/{STU-47,STU-48}.spec.ts`, typed client `@qa/fake-llm/client`                                       |
| Reset            | `POST /__admin/reset` in `beforeEach` — fixtures must be stateless across retries                                   |
| CI               | dedicated **`ai-suite`** job, not a QA shard: its app process needs `LLM_BASE_URL`                                  |
| App env          | `LLM_BASE_URL=http://127.0.0.1:4321/v1`, `LLM_API_KEY=qa-fake-key`, `LLM_MODEL_NAME=qa-fake`                        |
| Order            | `/healthz` check **before** the app starts — otherwise the app retries 3× per call and fails with a generic message |
| Workers          | `QA_WORKERS=2` (one Bun process serves the job)                                                                     |
| Outside the gate | nightly, `continue-on-error`, key-gated real-provider smoke asserting the happy path only                           |

`model.ts` reads `LLM_*` at import time, so the env must be set before `next start` — the same
constraint the QA job already follows for Supabase.

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
| MVP fault set               | the six in §2                                                                                                                    |

## 9. Scope

```
qa/fake-llm/           server, engine, stream, journal, client  ≈ 400 LOC
                       cases/*.json                            ~15 fixtures
__tests__/qa/AI/       STU-47.spec.ts, STU-48.spec.ts           ≈ 150 LOC each
.github/workflows/     ai-suite job
```

**Phase 0 (½ day):** engine skeleton + one hard-coded fixture + the purity test.
**Phase 1 (1–1.5 days):** matcher, ordered turns, `maxTurns`, six faults, journal, ten
fixtures, two specs, CI job.
**Phase 2:** `hangAfter`, control API, usage/no-usage accounting specs, nested-failure fixture,
`EDU-DECK-05`.

## 10. Open items

1. **`interrupted`** — v7 defines it, but the openai-compatible path does not emit it (§5). If
   a future provider adapter starts emitting it, the fixture `finish` enum and one taxonomy row
   change; nothing structural.
2. **Streaming token accounting** — should the provider opt into `includeUsage`, or should the
   fake server always send a usage chunk so the counter is exercised? Product decision, and the
   fixtures work either way.
3. **Where the engine lives long-term** — `qa/` today; if a second consumer appears (the nested
   provider tests), it may deserve `scripts/`.
