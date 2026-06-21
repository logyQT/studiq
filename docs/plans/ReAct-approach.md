# ReAct Multi-Agent Architecture

## Overview

Replace the current hardcoded 4-step flashcard pipeline with a **ReAct-based multi-agent system**. A general agent orchestrates sub-agents via tool calls, enabling dynamic planning, user clarification, and extensibility to any educational domain (flashcards, questions, notes, learning paths, etc.).

## Architecture

```
User Request
    │
    ▼
┌──────────────────────────────────────────────────────┐
│                  GENERAL AGENT                         │
│                                                        │
│  Generic tools:                                        │
│  ├── create_plan          — build execution plan        │
│  ├── ask_user             — clarify ambiguities         │
│  ├── fetch_material       — generate content on topic   │
│  ├── extract_concepts     — identify key ideas          │
│  ├── evaluate_quality     — self-review output          │
│  ├── call_agent           — delegate to sub-agent       │
│  └── finish               — finalize & return           │
└───────────────────┬────────────────────────────────────┘
                    │
          call_agent("flashcard", task)
          call_agent("question", task)   ← future
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼                ▼
┌──────────┐ ┌──────────┐  ┌──────────────┐
│ FLASHCARD│ │ QUESTION │  │   NOTES      │
│ AGENT    │ │ AGENT    │  │   AGENT      │
│ (now)    │ │ (future) │  │   (future)   │
│          │ │          │  │              │
│ Tools:   │ │ Tools:   │  │ Tools:       │
│ f-create │ │ q-create │  │ n-create     │
│ f-review │ │ q-review │  │ n-organize   │
│ f-revise │ │ q-cat    │  │ n-enrich     │
│ f-brain  │ │          │  │              │
│          │ │          │  │              │
│ Has own  │ │ Has own  │  │ Has own      │
│ system   │ │ system   │  │ system       │
│ prompt + │ │ prompt +  │  │ prompt +    │
│ tool set │ │ tool set  │  │ tool set     │
└──────────┘ └──────────┘  └──────────────┘
```

### Flow

1. **General Agent receives user request**
2. **Planning phase**: LLM calls `create_plan` tool to define steps
3. **Clarification** (if needed): LLM calls `ask_user` tool to resolve ambiguity
4. **Execution loop**: General agent calls generic tools or `call_agent` to delegate
5. **Sub-agent execution**: FlashcardAgent (or other) runs its own ReAct loop with domain-specific tools
6. **Result aggregation**: General agent collects sub-agent results, calls `evaluate_quality`, then `finish`

## File Structure

```
src/server/
├── agents/
│   ├── base.agent.ts                   ← Abstract ReAct loop
│   ├── general.agent.ts                ← Orchestrator
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
│   │   ├── extract-concepts.tool.ts
│   │   ├── evaluate-quality.tool.ts
│   │   ├── call-agent.tool.ts
│   │   └── finish.tool.ts
│   │
│   └── flashcard/
│       ├── index.ts                    ← barrel
│       ├── flashcard-create.tool.ts
│       ├── flashcard-review.tool.ts
│       ├── flashcard-revise.tool.ts
│       └── brainstorm-concepts.tool.ts
│
├── ai/
│   ├── llm-gateway.ts                  ← accept per-call LLM config
│   └── ai.types.ts
│
├── services/
│   ├── agent.service.ts                ← Entry point: creates GeneralAgent, delegates
│   ├── ai-command.service.ts           ← UNCHANGED legacy pipeline
│   ├── ai-prompts.ts                   ← EXTRACTED prompt/tool constants
│   └── ai-utils.ts                     ← EXTRACTED shared utilities
│
└── config/
    ├── feature-flags.ts
    └── agent-models.config.ts           ← Per-agent LLM model config
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
  general:   { provider: 'opencode', model: 'mimo-v2.5' },
  flashcard: { provider: 'opencode', model: 'mimo-v2.5', maxTokens: 8192 },
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
| GeneralAgent (orchestrator) | ✅ Done | 8 generic tools |
| FlashcardAgent (sub-agent) | ✅ Done | 4 flashcard tools |
| `call_agent` tool | ✅ Done | Delegates to FlashcardAgent |
| Question flow (`ask_user`) | ✅ Done | SSE `question` event |
| LLM retry logic | ✅ Done | 3 retries, 5s base delay |
| AgentTraceService | ✅ Done | In-memory + SQLite persistence |
| Dev traces endpoint | ✅ Done | `GET /api/v1/dev/traces` |
| `webfetch` tool | ✅ Done | Generic URL fetch → `state.material` |
| QuestionAgent | ⏳ Planned | |
| NotesAgent | ⏳ Planned | |
| LearningPathAgent | ⏳ Planned | |
| Trace viewer UI | ⏳ Planned | |
| Prod auth for dev endpoint | 🔮 Distant | 3+ months |
| Pipeline/Agent mode toggle | 🆕 Not yet built | User chooses fast vs flexible |
| `chat` tool | ✅ Done | Conversational responses without ReAct overhead |
| FlashcardAgent `finish` tool | ✅ Done | Prevents infinite loops |
| `flashcard_review` `passed` signal | ✅ Done | Clear "done" signal for LLM |
| Consecutive tool call guard | ✅ Done | Force-finish after 3 same-tool calls |
| `globalThis` trace singleton | ✅ Done | Fixes module isolation in dev mode |
| Conversation state persistence | ✅ Done | Multi-turn memory via `conversationId` |

## Future Plans

### Now — Testing & validation

- Manual smoke tests for the agent pipeline: flashcard generation, PDF upload, ambiguous → clarification flow, webfetch flow
- Verify retry logic handles transient 5xx without dropping the SSE stream
- Verify trace endpoint returns expected data with and without `?conversationId=`

### Near term (1–3 months)

- **More sub-agents**: QuestionAgent, NotesAgent, LearningPathAgent — same pattern: own agent file, own tool directory, register in `agent-registry.ts`
- **Trace logging hardening**:
  - TTL-based pruning to cap memory usage
  - Configurable log level filtering (info / warn / error)
  - `.dev/traces.db` compaction and rotation
  - Optional endpoint auth via simple bearer token derived from `NEXT_PUBLIC_APP_URL` or a fixed env var — lightweight, sufficient for local debugging across a LAN

### Distant future (3+ months)

- **Production auth** for `/api/v1/dev/traces` — proper RBAC (SYS_ADMIN only) when exposed beyond localhost
- **Persistent trace storage** in PostgreSQL (instead of SQLite) for cross-instance debugging
- **Trace viewer UI** — standalone page under `/dev` or `/admin`

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
