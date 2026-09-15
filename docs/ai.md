# AI System

> Unified reference for the StudiQ AI subsystem. Covers architecture, current tools, extension guide, and security posture.

---

## Architecture

Agent Q is a runtime AI chat session built with [Vercel AI SDK](https://sdk.vercel.ai) (`streamText()`). It is **not** a persistent database entity — it exists only within a single HTTP request.

```
POST /api/v1/ai/chat
  → Auth check (manual getUser)
  → streamText(model, systemPrompt, tools)
    → ReAct loop:
        1. LLM decides: tool call, question, or finish
        2. Tool executes server-side → result fed back
        3. Loop until finish or 30 steps
  → Streaming response via SSE
```

### Two pipelines (legacy vs agent)

| Pipeline | When | Speed | Status |
|----------|------|-------|--------|
| **Agent** (`FEATURE_FLAG_AGENTIC=true`) | All requests when enabled | 2–5 min (ReAct loop) | Primary, live |
| **Legacy** (tool calling) | Fallback when flag off | 15–30s (3–4 LLM calls) | Maintenance mode, will be removed |

Both share `POST /api/v1/ai/chat`. The feature flag `FEATURE_FLAG_AGENTIC` dispatches between them.

### Key files

| File | Role |
|------|------|
| `src/app/(backend)/api/v1/ai/chat/route.ts` | Entry point — auth, streamText, tool registration |
| `src/server/agents/core/base.agent.ts` | Abstract ReAct loop |
| `src/server/agents/general.agent.ts` | Agent Q orchestrator (9 generic tools) |
| `src/server/agents/flashcard.agent.ts` | Flashcard sub-agent (5 tools) |
| `src/server/agents/agent-registry.ts` | Singleton — maps agent names to instances |
| `src/server/agents/system.ts` | Agent Q system prompt |
| `src/server/services/agent.service.ts` | Entry point — constructs ToolContext, calls GeneralAgent |
| `src/server/ai/model.ts` | LLM model config (provider-agnostic via `@ai-sdk/openai-compatible`) |
| `src/server/config/agent-models.config.ts` | Per-agent model overrides |
| `src/server/services/agent-trace.service.ts` | In-memory + SQLite trace storage |
| `src/lib/conversation-context.ts` | `AsyncLocalStorage` for conversation ID |
| `src/hooks/use-ai-chat.ts` | Client hook — SSE parsing, message state |
| `src/components/ai/*.tsx` | UI: ChatScreen, FlashcardBlock, ThinkingBlock, QuestionBlock |

---

## Tools

### GeneralAgent (Agent Q) — 9 tools

| Tool | Description | Side Effects | DB Access |
|------|-------------|-------------|-----------|
| `create_plan` | Build multi-step execution plan | Trace log | None |
| `ask_user` | Ask clarifying question (SSE `question` event) | Trace log, stream pause | None |
| `fetch_material` | Generate educational content via nested LLM call | `generateText()` | None |
| `webfetch` | Fetch content from URL | External HTTP | None |
| `extract_concepts` | Extract key terms from material | Trace log | None |
| `evaluate_quality` | Review output quality | No-op (always passes) | None |
| `call_agent` | Delegate to sub-agent | Trace log | None |
| `batch_call_agent` | Parallel sub-agent dispatch (concurrency control) | Trace log | None |
| `finish` | Complete and return results | Trace log | None |

### FlashcardAgent — 5 tools

| Tool | Description |
|------|-------------|
| `brainstorm_concepts` | Generate topic concepts for flashcard creation |
| `flashcard_create` | Generate flashcards from concepts |
| `flashcard_review` | Review generated flashcards for quality |
| `flashcard_revise` | Revise flashcards based on feedback |
| `finish` | Return final flashcard collection |

### Design rule: tools never touch the database

All tools are **stateless processors**. They receive input from the LLM, process it, and return results. Flashcard saving happens **client-side** through normal authenticated API routes (`POST /api/v1/flashcards/decks`, `POST /api/v1/flashcards/batch/create`), which go through full RBAC.

This is an intentional architectural constraint — see [Security](#security).

---

## Agent lifecycle

### Adding a new sub-agent

1. Create `src/server/agents/{name}.agent.ts` — extends `BaseAgent`

```typescript
import { BaseAgent } from '@/server/agents/core/base.agent';

export class QuestionAgent extends BaseAgent {
  name = 'question';
  systemPrompt = QUESTION_SYSTEM_PROMPT;
  tools = [questionCreate, questionReview, finish];
  // llmConfig? — optional model override
}
```

2. Create tool files in `src/server/agents/tools/{name}/`

```typescript
import { z } from '@/lib/zod';
import type { Tool } from '@/server/agents/tools/types';

export const questionCreate: Tool = {
  name: 'question_create',
  description: 'Generate a quiz question',
  parameters: z.object({ /* ... */ }),
  async execute(args, ctx) {
    // Process — no DB access
    return { question: /* ... */ };
  },
};
```

3. Add barrel export in `src/server/agents/tools/{name}/index.ts`
4. Add entry in `src/server/config/agent-models.config.ts`
5. Register in `src/server/agents/agent-registry.ts`

The `call_agent` tool auto-discovers agents from the registry.

### Adding a new generic tool

1. Create `src/server/agents/tools/generic/{name}.tool.ts`
2. Add to the tools array in `src/server/agents/general.agent.ts`
3. Add barrel export in `src/server/agents/tools/generic/index.ts`

---

## SSE events

| Event | Payload | When |
|-------|---------|------|
| `token` | `{ text }` | LLM token during streaming |
| `thinking` | `{ agent, step, label, description }` | ReAct iteration / sub-agent step |
| `tool_call` | `{ toolName, label, args }` | Tool execution starts |
| `tool_result` | `{ toolName, label, result, durationMs }` | Tool execution completes |
| `question` | `{ id, text, options }` | `ask_user` — agent needs clarification |
| `flashcards` | `{ deckName, flashcards }` | Flashcard generation complete |
| `complete` | `{ message }` | All processing done |
| `usage` | `{ current, limit, plan, resetsAt }` | Usage limit info |
| `error` | `{ message }` | Any failure |

---

## Auth & security

### Current auth flow

The AI chat route does **not** use the standard `withAuth()` wrapper. It performs a manual `getUser()` check:

```typescript
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return toNextResponse({ statusCode: 401, error: 'UNAUTHORIZED' });
```

This means:
- ✅ User is authenticated
- ❌ No `RequestContext` built (no org context, no permission scopes)
- ❌ No `allowedAccountTypes` enforcement (route config says STUDENT/EDUCATOR but handler doesn't check)
- ❌ No token budget enforcement (the simpler `ChatController` path enforces limits, agent route doesn't)
- ❌ No rate limiting

### Security posture

| Aspect | Status |
|--------|--------|
| Agent tools access DB | ❌ No — tools are stateless |
| Flashcard saving goes through RBAC | ✅ Yes — client-side API calls |
| RLS enabled | ❌ No — disabled system-wide, app-layer auth only |
| SSRF protection on `webfetch` | ❌ No — arbitrary URLs allowed |
| Account type enforced | ❌ No — declared in route config, not enforced |

**Full audit and hardening plan:** [`docs/plans/agent-security.md`](plans/agent-security.md)

### Architectural constraints (enforced)

1. **Tools never touch the database.** All data access goes through client-side API calls with proper RBAC.
2. **Agent sessions are stateless.** No persistent state beyond conversation `AsyncLocalStorage`.
3. **Every tool validates its inputs.** Zod schemas on all tool parameters.
4. **Network calls require allowlists.** (Not yet implemented — see security doc.)
5. **The agent route must build a `RequestContext`.** (Not yet implemented — see security doc.)

---

## Configuration

### LLM model

Configured via environment variables (`src/server/ai/model.ts`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `LLM_PROVIDER` | `opencode` | Provider name |
| `LLM_API_KEY` | — | API key |
| `LLM_MODEL_NAME` | `mimo-v2.5` | Model identifier |
| `LLM_BASE_URL` | `https://opencode.ai/zen/go/v1` | OpenAI-compatible endpoint |
| `LLM_REASONING_EFFORT` | `medium` | `low` / `medium` / `high` |

### Per-agent model overrides

`src/server/config/agent-models.config.ts`:

```typescript
export const agentModels = {
  general:   { provider: 'opencode', model: 'mimo-v2.5', reasoningEffort: 'medium' },
  flashcard: { provider: 'opencode', model: 'mimo-v2.5', maxTokens: 8192, reasoningEffort: 'high' },
};
```

### Feature flag

`FEATURE_FLAG_AGENTIC` (env var) — when `true`, all `/api/v1/ai/chat` requests use the agent pipeline.

---

## Known issues & planned work

| Priority | Issue | Status |
|----------|-------|--------|
| P0 | No account type enforcement on agent route | 🔴 Open |
| P0 | No URL allowlist for `webfetch` (SSRF risk) | 🔴 Open |
| P0 | No token budget enforcement on agent route | 🔴 Open |
| P1 | No `RequestContext` in agent execution | 🔴 Open |
| P1 | No rate limiting on `/api/v1/ai/chat` | 🟡 Open |
| P2 | `evaluate_quality` is a no-op | 🟡 Open |
| P2 | Per-sub-agent timeout in `batch_call_agent` | 📋 Planned |
| P2 | Per-task error isolation in batch | 📋 Planned |
| P3 | Conversation state persistence to PostgreSQL | 💤 Deferred |
| P3 | Trace viewer UI | 💤 Deferred |

**Security hardening plan:** [`docs/plans/agent-security.md`](plans/agent-security.md)

---

## Testing

| Type | Location | Status |
|------|----------|--------|
| Unit | `__tests__/unit/agents/` | ✅ `generic.test.ts` exists |
| Integration | `__tests__/integration/` | No agent-specific suites yet |
| E2E | `__tests__/e2e/` | Not yet planned |

Run agent tests: `bunx vitest run __tests__/unit/agents/`

---

## Debugging

- **Trace events:** In-memory store + SQLite in dev (`.dev/traces.db`)
- **Dev endpoint:** `GET /api/v1/dev/traces?conversationId=xxx` (403 in production)
- **Logs:** Consola structured logging (`log.ai`, `log.providers`)
