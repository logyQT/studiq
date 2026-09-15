# ReAct Multi-Agent Architecture

> **Last updated: June 2026** — reflects all changes since initial creation (Apr 2026).
> See [changelog](#changelog) at bottom for a summary of what changed.

## Overview

Replace the current hardcoded 4-step flashcard pipeline with a **ReAct-based multi-agent system**. A general agent ("Agent Q") orchestrates sub-agents via tool calls, enabling dynamic planning, user clarification, and extensibility to any educational domain (flashcards, questions, notes, learning paths, etc.).

## Architecture

```
User Request
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│                 GENERAL AGENT (Agent Q)                   │
│                                                            │
│  Generic tools:                                            │
│  ├── create_plan          — build execution plan            │
│  ├── ask_user             — clarify ambiguities             │
│  ├── fetch_material       — generate content on topic       │
│  ├── extract_concepts     — identify key ideas              │
│  ├── webfetch             — fetch URL content               │
│  ├── evaluate_quality     — self-review output              │
│  ├── call_agent           — delegate to sub-agent           │
│  ├── batch_call_agent     — parallel sub-agent dispatch     │
│  └── finish               — finalize & return               │
└───────────────────┬────────────────────────────────────────┘
                    │
          call_agent / batch_call_agent("flashcard", task)
          call_agent("question", task)         ← future
                    │
    ┌───────────────┼─────────────────┐
    ▼               ▼                  ▼
┌──────────┐ ┌──────────┐  ┌────────────────┐
│ FLASHCARD│ │ QUESTION │  │   NOTES        │
│ AGENT    │ │ AGENT    │  │   AGENT        │
│ (✅ now) │ │ (⏳ future)│  │ (⏳ future)    │
│          │ │          │  │                │
│ Tools:   │ │ Tools:   │  │ Tools:         │
│ f-create │ │ q-create │  │ n-create       │
│ f-review │ │ q-review │  │ n-organize     │
│ f-revise │ │ q-cat    │  │ n-enrich       │
│ f-brain  │ │          │  │                │
│          │ │          │  │                │
│ Has own  │ │ Has own  │  │ Has own        │
│ system   │ │ system   │  │ system         │
│ prompt + │ │ prompt +  │  │ prompt +      │
│ tool set │ │ tool set  │  │ tool set       │
└──────────┘ └──────────┘  └────────────────┘
```

### Flow

1. **General Agent receives user request**
2. **Planning phase**: LLM calls `create_plan` tool to define steps
3. **Clarification** (if needed): LLM calls `ask_user` tool to resolve ambiguity
4. **Execution loop**: General agent calls generic tools or `call_agent`/`batch_call_agent` to delegate
5. **Sub-agent execution**: FlashcardAgent (or other) runs its own ReAct loop with domain-specific tools
6. **Token streaming**: LLM tokens are streamed in real-time via `onToken` callback
7. **Result aggregation**: General agent collects sub-agent results, calls `evaluate_quality`, then `finish`

## File Structure

```
src/server/
├── agents/
│   ├── core/
│   │   ├── base.agent.ts               ← Abstract ReAct loop
│   │   └── schema-helper.ts            ← Zod → JSON Schema helper
│   ├── general.agent.ts                ← Orchestrator (Agent Q)
│   ├── flashcard.agent.ts              ← Flashcard sub-agent
│   ├── agent-registry.ts               ← Map<name, Agent>
│   └── index.ts
│
├── agents/tools/
│   ├── types.ts                        ← Tool, ToolContext, AgentState types
│   ├── index.ts                        ← barrel (re-exports all tool dirs)
│   │
│   ├── generic/
│   │   ├── index.ts                    ← barrel
│   │   ├── create-plan.tool.ts
│   │   ├── ask-user.tool.ts
│   │   ├── fetch-material.tool.ts
│   │   ├── webfetch.tool.ts
│   │   ├── extract-concepts.tool.ts
│   │   ├── evaluate-quality.tool.ts
│   │   ├── call-agent.tool.ts
│   │   ├── batch-call-agent.tool.ts    ← Parallel sub-agent dispatch (NEW)
│   │   └── finish.tool.ts
│   │
│   └── flashcard/
│       ├── index.ts                    ← barrel
│       ├── brainstorm-concepts.tool.ts
│       ├── flashcard-create.tool.ts
│       ├── flashcard-review.tool.ts
│       └── flashcard-revise.tool.ts
│
├── ai/
│   ├── llm-gateway.ts                  ← accept per-call LLM config
│   └── ai.types.ts
│
├── services/
│   ├── agent.service.ts                ← Entry point: creates GeneralAgent, delegates
│   ├── agent-trace.service.ts          ← In-memory + SQLite trace persistence
│   ├── ai-command.service.ts           ← LEGACY pipeline (maintenance mode)
│   ├── ai-prompts.ts                   ← EXTRACTED prompt/tool constants
│   └── ai-utils.ts                     ← EXTRACTED shared utilities
│
├── controllers/
│   └── ai-agent.controller.ts          ← SSE callback bridge
│
└── config/
    ├── agent-models.config.ts           ← Per-agent LLM model config
    └── ...
```

## Key Components

### BaseAgent (`base.agent.ts`)

Abstract class implementing the ReAct loop:

```
LLM call (system prompt + tools + state)
    │
    ├── tool_call → execute tool → append result → loop
    ├── text response → might be question or done
    └── finish tool → parse results → return
```

Each agent provides:
- `name` — unique identifier
- `systemPrompt` — domain-specific instructions
- `tools` — domain-specific tool set
- `llmConfig?` — optional per-agent model override

### Tool Pattern

Every tool is a standalone file in `tools/{domain}/{name}.tool.ts`:

```typescript
export const toolName: Tool = {
  name: 'tool_name',
  description: '...',
  parameters: z.object({ ... }),
  async execute(args, ctx) {
    // Implementation
    return result;
  },
};
```

Each domain directory has a barrel `index.ts`. The top-level `tools/index.ts` re-exports all domains.

### Per-Agent LLM Config

Defined in `agent-models.config.ts`, allows different models per agent:

```typescript
export const agentModels = {
  general:   { provider: 'opencode', model: 'mimo-v2.5', reasoningEffort: 'medium' },
  flashcard: { provider: 'opencode', model: 'mimo-v2.5', maxTokens: 8192, reasoningEffort: 'high' },
  // question: { provider: 'openai', model: 'gpt-4o' },
};
```

### call_agent Tool

The general agent delegates to sub-agents via `call_agent`:

```typescript
call_agent({ agent: 'flashcard', task: 'Create flashcards from these concepts', context: { ... } })
    → FlashcardAgent.execute(task, context)
    → returns { type: 'flashcards', deckName, flashcards }
```

Sub-agents return structured results (not streaming). The general agent incorporates them into its state.

### batch_call_agent Tool

For large requests (50+ flashcards), the general agent uses `batch_call_agent` to dispatch multiple sub-agent invocations in parallel:

```typescript
batch_call_agent({
  batches: [
    { agent: 'flashcard', task: 'Generate 25 cards on topic A', concepts: [...], count: 25 },
    { agent: 'flashcard', task: 'Generate 25 cards on topic B', concepts: [...], count: 25 },
  ],
  concurrency: 3,
})
    → runs up to 3 sub-agents simultaneously
    → combines all flashcards into a single collection
    → returns { type: 'flashcards', deckName, flashcards, summary }
```

A worker-pool pattern (`runWithConcurrency`) limits parallel execution. Each sub-agent gets its own isolated state and callbacks (with `[batch]` prefix on thinking traces).

## Implementation Order

| Step | What | Files | Legacy Impact | Status |
|------|------|-------|--------------|--------|
| 1 | Extract prompts + utils | `ai-prompts.ts`, `ai-utils.ts` | Refactor only | ✅ Done |
| 2 | Per-agent LLM config | `llm-gateway.ts`, `agent-models.config.ts` | None | ✅ Done |
| 3 | Tool infrastructure | `types.ts`, per-tool files | None | ✅ Done |
| 4 | BaseAgent | `base.agent.ts` | None | ✅ Done |
| 5 | FlashcardAgent | `flashcard.agent.ts` | None | ✅ Done |
| 6 | GeneralAgent + call-agent tool | `general.agent.ts`, `call-agent.tool.ts` | None | ✅ Done |
| 7 | AgentRegistry + AgentService | `agent-registry.ts`, `agent.service.ts` | None | ✅ Done |
| 8 | Feature flag + route integration | `feature-flags.ts`, `route.ts` | Toggleable | ✅ Done |
| 9 | Testing | Unit + integration | Validates both paths | ✅ Done |
| 10 | `batch_call_agent` tool | `batch-call-agent.tool.ts` | None | ✅ Done |
| 11 | Token streaming (`onToken`/`onReasoning`) | `base.agent.ts`, `types.ts` | None | ✅ Done |
| 12 | Plan SSE event + `PlanBlock` UI | `ai-agent.controller.ts`, `plan-block.tsx` | None | ✅ Done |
| 13 | `paused` SSE event (question → stream pause) | `ai-agent.controller.ts`, `route.ts` | None | ✅ Done |
| 14 | Structured logging (consola) | route.ts, all services/controllers | Refactor only | ✅ Done |
| 15 | Stream timeout (5min) + `safeClose` guard | `route.ts` | None | ✅ Done |

## Adding a New Sub-Agent (Future)

1. Create `src/server/agents/{name}.agent.ts` — extends BaseAgent
2. Create `src/server/agents/tools/{name}/{tool}.tool.ts` files
3. Add entry in `agent-models.config.ts`
4. Register in `agent-registry.ts`

The `call_agent` tool auto-discovers new agents from the registry.

## Notes

- **Step event propagation**: Sub-agents should propagate "step" events up to the general agent. When a sub-agent moves to step X of its plan, it fires a step event → the general agent receives it → streams it to the chat as a thinking trace. This gives the user real-time visibility into what each agent is doing, not just the top-level orchestrator. The event should include: agent name, step number/label, and a human-readable description.

---

## Current Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| GeneralAgent (orchestrator — Agent Q) | ✅ Done | 9 generic tools (chat tool removed, replaced by direct text response) |
| FlashcardAgent (sub-agent) | ✅ Done | 5 flashcard tools, maxIterations=30 |
| `call_agent` tool | ✅ Done | Delegates to sub-agents, tracks tool count |
| `batch_call_agent` tool | ✅ Done | Parallel sub-agent dispatch with concurrency control |
| Token streaming (`onToken`) | ✅ Done | Real-time LLM token streaming to UI |
| Reasoning streaming (`onReasoning`) | ✅ Done | Thinking traces streamed as `thought` SSE events |
| Plan SSE event + `PlanBlock` UI | ✅ Done | Execution plan shown as collapsible step list |
| `paused` SSE event | ✅ Done | Stream pauses when agent asks a question |
| Question flow (`ask_user`) | ✅ Done | SSE `question` event with option buttons |
| LLM retry logic | ✅ Done | 3 retries, 5s/10s/15s exponential backoff |
| AgentTraceService | ✅ Done | In-memory + async SQLite persistence (bun:sqlite) |
| Dev traces endpoint | ✅ Done | `GET /api/v1/dev/traces` (403 in production) |
| `webfetch` tool | ✅ Done | Generic URL fetch → `state.material` |
| `fetch_material` tool | ✅ Done | LLM generates educational content on a topic |
| `extract_concepts` tool | ✅ Done | Identifies key terms, 20000 char truncation guard |
| `evaluate_quality` tool | ✅ Done | Self-review output quality |
| Stream timeout (5min) | ✅ Done | `safeClose()` prevents dangling streams |
| Structured logging (consola) | ✅ Done | Replaced all `console.log` calls |
| FlashcardAgent `finish` tool | ✅ Done | Prevents infinite loops |
| `flashcard_review` `passed` signal | ✅ Done | Clear "done" signal for LLM |
| Consecutive tool call guard | ✅ Done | Force-finish after 3 same-tool calls |
| Loop detection improvement | ✅ Done | Bailout after 2 silent iterations with same last tool |
| `globalThis` trace singleton | ✅ Done | Fixes module isolation in dev mode |
| Conversation state persistence | ✅ Done | In-memory LRU (max 100), not DB-persisted |
| State accumulation on `flashcard_create` | ✅ Done | Appends to existing results array (not replace) |
| Truncation protection (brainstorm) | ✅ Done | Recovers from truncated JSON output |
| QuestionAgent | ⏳ Planned | |
| NotesAgent | ⏳ Planned | |
| LearningPathAgent | ⏳ Planned | |
| ReportAgent | ⏳ Planned | Teacher custom reports |
| Trace viewer UI | ⏳ Planned | |
| Prod auth for dev endpoint | 🔮 Distant | 3+ months |
| Pipeline/Agent mode toggle | 🆕 Not yet built | User chooses fast vs flexible |
| `chat` tool | 🗑️ Removed | Replaced by direct text response from GeneralAgent |
| Per-task error isolation (batch) | ⏳ Needed | Each sub-agent error crashes the whole batch |
| Per-sub-agent timeout | ⏳ Needed | No individual timeout for sub-agents in batch |

## Future Plans

### Now — Large flashcard generation (200 cards under 5 min)

Current `batch_call_agent` works for moderate loads (50-100 cards) but **fails for 200 cards** within the 5-minute stream timeout. Root causes:
- Each sub-agent in a batch has no individual timeout — one slow agent blocks all results
- No per-task error isolation — a single sub-agent rejection crashes the whole batch (`Promise.all`)
- `brainstorm_concepts` with 200 concepts generates huge output that gets truncated, causing JSON parse failures
- The ReAct loop amplifies latency: 4 sub-agents × 3-5 iterations each = 12-20 LLM calls minimum

Planned fixes:
- **Per-sub-agent timeout**: Each batch task gets a configurable timeout (default 90s)
- **Per-task error isolation**: Wrap each sub-agent in try/catch so failures don't cascade
- **Batch-level finish**: Allow the general agent to finish with partial results instead of requiring all batches to complete
- **Streaming progress per sub-agent**: Emit individual `tool_call`/`tool_result` events for each sub-agent within a batch

### Near term (1–3 months)

- **More sub-agents**: QuestionAgent, NotesAgent, LearningPathAgent, ReportAgent — same pattern: own agent file, own tool directory, register in `agent-registry.ts`
- **Token budget management**: Truncate conversation history when it exceeds a threshold (e.g., last 20 messages)
- **Per-sub-agent timeout** in `batch_call_agent` — prevent one slow agent from blocking the whole batch
- **Conversation state persistence** to PostgreSQL (instead of in-memory LRU)
- **Trace logging hardening**:
  - TTL-based pruning to cap memory usage
  - Configurable log level filtering (info / warn / error)
  - `.dev/traces.db` compaction and rotation
- **Platform guidance mode**: Agents can guide users through the StudiQ platform (navigation tips, feature suggestions) — role-based access: FREE, PREMIUM, STUDENT, TEACHER, UNIVERSITY_ADMIN (opt-in), excluding SYS_ADMIN
- **Teacher reports**: `ReportAgent` sub-agent that queries API endpoints and generates custom reports (student progress, topic struggles, group analytics)

### Distant future (3+ months)

- **Production auth** for `/api/v1/dev/traces` — proper RBAC (SYS_ADMIN only) when exposed beyond localhost
- **Persistent trace storage** in PostgreSQL (instead of SQLite) for cross-instance debugging
- **Trace viewer UI** — standalone page under `/dev` or `/admin`
- **Agent-initiated actions**: UNIVERSITY_ADMIN can opt in to allow the agent to perform actions (e.g., auto-update user roles, modify settings) based on natural language requests

## Question Tool Call Ordering

The `ask_user` tool call currently shows as a thinking trace *after* the question appears. This is backwards — the user should see the agent working before seeing the question.

### Current behavior

```
User: "Chcę zrobić fiszki"
Agent: [thinking] Using tool: ask_user
Agent: [thinking] Tool ask_user done
Agent: [question] Ile fiszek chcesz? (10, 20, 30)
```

### Desired behavior

```
User: "Chcę zrobić fiszki"
Agent: [tool_call] Asking Questions... (spinner)
       ↓ updates to ↓
Agent: [tool_call] Question Sent ✓
Agent: [question] Ile fiszek chcesz? (10, 20, 30)
```

### Implementation approach

1. **Controller** (`ai-agent.controller.ts`): For `ask_user` tool, emit `tool_call` SSE event when `onToolCall` fires, then `tool_result` when `onToolResult` fires (instead of mapping both to `thinking`)
2. **Frontend** (`use-ai-chat.ts`): Handle `tool_call`/`tool_result` SSE events to insert/update messages with `role: 'tool_call'`
3. **Message rendering** (`chat-message.tsx`): Already renders `ToolCallBlock` for `tool_call` role — no changes needed

This preserves the full history of what happened while showing the tool call *before* the question.

---

## Changelog

| Date | Change |
|------|--------|
| Jun 2026 | Added `batch_call_agent` tool for parallel sub-agent dispatch with concurrency control |
| Jun 2026 | Removed `chat` tool — replaced by direct text response from GeneralAgent |
| Jun 2026 | GeneralAgent rebranded to "Agent Q" with expanded system prompt |
| Jun 2026 | Token streaming (`onToken`) + reasoning streaming (`onReasoning`) |
| Jun 2026 | Plan SSE event + `PlanBlock` UI component |
| Jun 2026 | `paused` SSE event — stream pauses when agent asks a question |
| Jun 2026 | Stream timeout protection (5min) + `safeClose()` guard |
| Jun 2026 | Replaced all `console.log` with consola structured logging |
| Jun 2026 | AgentTraceService: made `log()`/`clear()` async, lazy SQLite `initDb()` |
| Jun 2026 | FlashcardAgent `maxIterations` increased from 10 to 30 |
| Jun 2026 | State accumulation on `flashcard_create` (appends to existing array) |
| Jun 2026 | Truncation protection: `extract_concepts` truncates at 20K chars; brainstorm recovers from truncated JSON |
| Jun 2026 | Loop detection: bailout after 2 silent iterations with same last tool |
| Jun 2026 | Removed `onThinking` from individual tools — centralized in `base.agent.ts` |
