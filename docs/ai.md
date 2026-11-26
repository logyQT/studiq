# AI System

> Reference for the StudiQ AI chat subsystem: architecture, tools, transport, auth, configuration, testing and debugging.

---

## Architecture

Agent Q is a runtime AI chat session built with the [Vercel AI SDK](https://sdk.vercel.ai) (`streamText()`). It is **not** a persistent database entity: it exists only within one HTTP request.

```
POST /api/v1/ai/chat
  → withAuth() builds the RequestContext
  → requireEntitlement(ctx, 'ai.chat')        — 403 without the entitlement
  → rate limit: 20 requests / 60 s per user
  → parse and validate UI messages
  → daily token budget (max_ai_tokens_per_day) — 429 USAGE_LIMIT_EXCEEDED when spent
  → streamText(chatModel, systemPrompt, tools)
      stop when the model calls finish or ask_user, or after 30 steps
  → AI SDK UI message stream (reasoning is not sent)
```

The route stores `{ conversationId, requestContext }` in `AsyncLocalStorage` for the whole tool-call stack. `conversationId` is the first message id, or a new UUID.

### Key files

| File                                                    | Role                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/web/src/app/(backend)/api/v1/ai/chat/route.ts`    | Entry point: auth, entitlement, rate limit, budget, `streamText` |
| `packages/server/src/agents/system.ts`                  | Agent Q system prompt                                            |
| `packages/server/src/agents/tools/generic/*.tool.ts`    | The seven registered tools                                       |
| `packages/server/src/agents/tools/generic/url-guard.ts` | SSRF guard used by `webfetch`                                    |
| `packages/server/src/ai/model.ts`                       | The single chat model and the `x-opencode-session` header        |
| `packages/server/src/lib/conversation-context.ts`       | `AsyncLocalStorage` for conversation id and `RequestContext`     |
| `packages/server/src/lib/trace-queue.ts`                | Fire-and-forget trace write                                      |
| `packages/server/src/services/agent-trace.service.ts`   | Trace storage in SQLite (`.dev/traces.db`)                       |
| `packages/server/src/lib/entitlements.ts`               | `requireEntitlement()`                                           |
| `packages/server/src/services/limits.ts`                | Daily token budget: `getUsage`, `trackTokenUsage`                |
| `apps/web/src/hooks/use-ai-chat.ts`                     | Client hook: `useChat`, transport, part-to-transcript mapping    |
| `apps/web/src/components/ai/`                           | Chat screen, flashcard block, question block, tool-call block    |

---

## Tools

The chat route registers these seven tools:

| Tool                  | Behavior                                                                  | Side effect     |
| --------------------- | ------------------------------------------------------------------------- | --------------- |
| `ask_user`            | Returns a question object with optional options. Stops the stream.        | Trace row       |
| `fetch_material`      | Calls `generateText()` with `GENERATE_MATERIAL_PROMPT` to create content. | Nested LLM call |
| `webfetch`            | Checks the URL with `assertSafeExternalUrl()`, then fetches it.           | Outbound HTTP   |
| `extract_concepts`    | Returns the `terms` array that the model supplies in the tool input.      | Trace row       |
| `evaluate_quality`    | No-op placeholder: always returns `{ passed: true }`.                     | Trace row       |
| `generate_flashcards` | Validates cards with `parseFlashcards()` and returns them.                | Trace row       |
| `finish`              | Returns chat text or the final flashcard list. Stops the stream.          | Trace row       |

### Design rule: tools never touch the database

No tool imports a Supabase client and no tool reads or writes a table. Tools receive input from the model, validate or transform it, and return a result. Flashcard saving happens **client-side** through authenticated routes (`POST /api/v1/flashcards/decks`, `POST /api/v1/flashcards/batch/create`), which apply the normal RBAC checks.

The route puts the caller's `RequestContext` in `conversationStorage`, so a future tool that needs the database has the org and permission scope available. The current tools read only `conversationId`.

---

## Adding a tool

1. Create `packages/server/src/agents/tools/generic/<name>.tool.ts`:

```typescript
import { z } from '@studiq/server/lib/zod';
import { tool } from 'ai';

export const myTool = tool({
  description: 'What the tool does',
  inputSchema: z.object({ input: z.string() }),
  execute: async ({ input }) => ({ result: input }),
});
```

2. Import it in `apps/web/src/app/(backend)/api/v1/ai/chat/route.ts` and add it to the `tools` object.
3. If the tool must end the turn, add `hasToolCall('<name>')` to `stopWhen`.
4. Add a test in `__tests__/unit/agents/tools/`.

There is no sub-agent registry and no barrel file. The chat route is the only place that assembles the tool set.

---

## Stream transport

The route returns an AI SDK **UI message stream** through `toUIMessageStreamResponse({ sendReasoning: false })`. It is not hand-written SSE. Text and tool parts arrive as message parts.

`apps/web/src/hooks/use-ai-chat.ts` uses `useChat` with `DefaultChatTransport({ api: '/api/v1/ai/chat' })` and maps parts to the transcript:

- `text` parts become assistant text messages.
- `tool-<name>` parts become tool-call rows with a label. A `dynamic-tool` part is folded into `tool-<name>`.
- A completed `generate_flashcards` result is buffered and rendered as a read-only preview.
- `ask_user` renders a question block. If a preview is buffered, the preview is emitted first.
- `finish` renders the final flashcard block or the chat text.

The model's reasoning never reaches the browser. The route sets `sendReasoning: false`, so prompt text and its jailbreak surface stay server-side. The fake inference server still emits `reasoning_content` so a spec can prove that the client drops it.

---

## Auth and security

### Request gate

`POST /api/v1/ai/chat` is wrapped in `withAuth()`, so the handler receives the full `RequestContext`. The handler then:

1. calls `requireEntitlement(ctx, 'ai.chat')` first, so a caller without the entitlement gets 403 before any other check;
2. applies a per-user rate limit of 20 requests per 60 seconds (`createRateLimiter`, in-memory, per server process);
3. validates the request body and the UI messages;
4. rejects the request with `USAGE_LIMIT_EXCEEDED` when the daily token budget is spent;
5. streams the answer and records the turn's token usage in `onFinish`.

`GET /api/v1/ai/usage` has the same `ai.chat` gate and returns the caller's current usage.

The account type is not a gate. Access is the `ai.chat` entitlement, so no persona is admitted or refused by type.

### Posture

| Aspect                             | Status                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| Agent tools access the database    | No. Tools are stateless.                                                                     |
| Flashcard saving goes through RBAC | Yes. The client calls the normal flashcard routes.                                           |
| RLS                                | Enabled on every public table. New tables enable RLS in their own migration.                 |
| SSRF protection on `webfetch`      | Yes. `assertSafeExternalUrl()` blocks non-HTTP(S), private, loopback and link-local targets. |
| Account access                     | Gated by the `ai.chat` entitlement, not by account type.                                     |

`webfetch` resolves DNS itself and fails closed when resolution fails. It blocks a public hostname that resolves to a private address. There is no domain allowlist.

### Architectural constraints

1. Tools never touch the database. Data access goes through client-side API calls with RBAC.
2. Agent sessions are stateless. The only request state is the `AsyncLocalStorage` entry.
3. Every tool declares a Zod `inputSchema`.
4. The chat route runs inside `withAuth()` and passes the `RequestContext` to the tool stack.
5. Both AI endpoints use the `ai.chat` entitlement gate.

---

## Configuration

### LLM model

`packages/server/src/ai/model.ts` defines one `chatModel` for every AI call. There are no per-agent model overrides.

| Variable               | Default                                      | Purpose                                             |
| ---------------------- | -------------------------------------------- | --------------------------------------------------- |
| `LLM_PROVIDER`         | `opencode-go`                                | Provider name                                       |
| `LLM_API_KEY`          | —                                            | API key                                             |
| `LLM_MODEL_NAME`       | `mimo-v2.6-flash`                            | Model identifier                                    |
| `LLM_BASE_URL`         | `https://opencode.ai/inference/go/openai/v1` | OpenAI-compatible endpoint                          |
| `LLM_REASONING_EFFORT` | unset (provider default)                     | `low`, `medium` or `high`; other values are ignored |

`LLM_BASE_URL` drops a trailing `/chat/completions`.

Every inference call carries `x-opencode-session`: the chat conversation id when there is one, a process-scoped id otherwise. OpenCode Go routes and caches on this header and rejects calls without it (`400 MissingSessionID`). A conversation id that is not a plain token is replaced by a stable FNV-1a digest.

The `LLM_*` values are read at import time. Set them before the build and before `next start`.

---

## Testing

| Type        | Location                                                                   | Contents                                                |
| ----------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| Unit        | `__tests__/unit/agents/tools/`, `__tests__/unit/api/ai-chat-route.test.ts` | Tool behavior, URL guard, route budget and wire options |
| Integration | `__tests__/integration/`                                                   | No AI-specific suites                                   |
| E2E         | `__tests__/e2e/ai-assistant.spec.ts`                                       | Routes, reset, plan gate, deck context                  |
| QA          | `__tests__/qa/AI/`                                                         | `STU-47`, `STU-48` against the fake inference server    |

```bash
bunx vitest run __tests__/unit/agents/
bun run test:e2e __tests__/e2e/ai-assistant.spec.ts
```

The QA cases use the fake inference server. Add a fixture in `scripts/fake-llm/cases/<CASE>.<slug>.json` and a spec in `__tests__/qa/AI/`; the engine does not change. Then run:

```bash
bun run mock:llm
bun run test:qa __tests__/qa/AI
```

The engine, fixture format and fault cases are described in [`docs/ai/fake-inference-server.md`](ai/fake-inference-server.md).

---

## Debugging

- **Trace storage:** `packages/server/src/services/agent-trace.service.ts` writes each event to SQLite at `.dev/traces.db` (`bun:sqlite`). Writes are fire-and-forget through `enqueueTrace()`; a failed write returns `null`.
- **Dev endpoint:** `GET /api/v1/dev/traces`. It returns 403 unless `NODE_ENV=development`, and it requires a session. Filters: `serverSessionId` (`current` by default, `all` for every session), `conversationId`, `eventType`, `label`, `agentName`, `limit`, `offset`, `sort`.
- **Trace events:** `streamText start`, each step start, each tool call, each step response, `streamText finish`, and `trackTokenUsage failed`. Rows carry the conversation id, agent name, token counts and finish reason.
- **Logs:** the OTel logger in `packages/server/src/lib/log.ts` (`log`/`warn`/`error`). Records carry the active trace id and fall back to `console` when the OTel pipeline is off.
