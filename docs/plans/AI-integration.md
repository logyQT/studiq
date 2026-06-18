# AI Integration Specification

This document describes the phased development of the AI subsystem for the StudiQ educational platform. Each phase builds on the previous one.

**Organization:**

- **Phase 1 (Basic/MVP)** — core AI features, usage controls, chat interface
- **Phase 2 (V2)** — new input types, modular commands, Tutor Mode
- **Phase 3 (V3)** — multi-agent pipelines, curriculum builder, workflows

---

## Legend

| Icon | Meaning                                |
| ---- | -------------------------------------- |
| ✅   | Already implemented in codebase        |
| ⚠️   | Partially implemented, needs extension |
| 🆕   | Not yet built                          |

---

# LLMGateway — Unified LLM Access Layer

Cross-cutting component — foundational dependency for all phases. A single function `callLLM` that is the **only code path** for all LLM communication — both external SaaS (OpenAI, Anthropic, Google, Groq) and self-hosted (Ollama, vLLM, etc.).

## API

```typescript
// src/server/ai/ai.types.ts  ✅

type LLMGatewayRequest = {
  prompt: string;
  systemPrompt?: string;
  file?: { data: string; mimeType: string };
  provider?: 'openai' | 'ollama';
  model?: string;
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
  tools?: ToolDefinition[];              // ✅ Added — OpenAI tool definitions
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };  // ✅ Added
};

type LLMGatewayResponse = {
  content: string;
  toolCalls?: ToolCall[];                // ✅ Added — parsed tool calls from response
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    provider: string;
    model: string;
  };
};

async function callLLM(req: LLMGatewayRequest, ctx: RequestContext): Promise<LLMGatewayResponse>;
```

## Responsibilities

Inside `callLLM`, executed in order:

1. **Provider resolution** — `req.provider` or fallback to `LLM_PROVIDER` env var
2. **Auth resolution** — reads correct API key for chosen provider (`OPENAI_API_KEY`, `LLM_API_KEY`)
3. **Usage guard** — invoke `checkUsage(ctx.userId, actionType, plan)` before HTTP call; reject early if limit exceeded
4. **Model selection** — `req.model` overrides `LLM_MODEL_NAME` env var
5. **Request assembly** — build provider-specific body, **attach tools if provided**
6. **HTTP call** — `fetch` with timeout, error mapping
7. **Response parsing** — extract content + **tool_calls** + token counts
8. **Usage recording** — `INSERT INTO usage_events(...)` (pending DB migration)
9. **Return** — `{ content, toolCalls?, usage }`

## Supported Providers

| Provider     | Env Key          | Default Model   | Notes                                               |
| ------------ | ---------------- | --------------- | --------------------------------------------------- |
| `openai`     | `OPENAI_API_KEY` | `gpt-4o-mini`   | Chat completions, **tool calling support**          |
| `ollama`     | (uses `LLM_BASE_URL`) | `phi3:mini` | Local, no tool calling support (text response only) |
| `opencode`   | `OPENAI_API_KEY` | `mimo-v2.5`     | OpenAI-compatible, **tool calling support**         |

## File / Multimodal Support

PDF and text files are processed server-side via text extraction — the raw file never reaches the LLM API:

- **PDF** — extracted via `unpdf` (previously `pdfjs-dist`), truncated to 15,000 chars, injected into prompt as `"File content:\n..."`
- **Text files** — decoded from base64, truncated to 15,000 chars, injected into prompt
- **Images** — not yet supported (mimo-v2.5 does not support vision)

The `file` field on `LLMGatewayRequest` exists but is unused in the gateway layer — file processing happens in the service layer before the LLM call.

## Usage in Pipelines

All services call `callLLM` exclusively — they never construct raw HTTP requests to LLM APIs.

```typescript
// In AiCommandService — flashcard generation via tool calling:
const response = await callLLM(
  {
    prompt,
    systemPrompt: SYSTEM_PROMPT,
    tools: [GENERATE_FLASHCARDS_TOOL],
    toolChoice: { type: 'function', function: { name: 'generate_flashcards' } },
  },
  ctx,
);

// Parse tool call response
if (response.toolCalls?.length) {
  const toolCall = response.toolCalls.find(tc => tc.function.name === 'generate_flashcards');
  const args = JSON.parse(toolCall.function.arguments);
  const flashcards = parseFlashcards(args.flashcards); // handles string or array
  return { deckName: args.deck_name, flashcards };
}
```

## Error Handling

| Condition               | AppError Code          |
| ----------------------- | ---------------------- |
| Network error / timeout | `SERVICE_UNAVAILABLE`  |
| Invalid API key         | `UNAUTHORIZED`         |
| Provider rate limit     | `RATE_LIMITED`         |
| Usage limit exceeded    | `USAGE_LIMIT_EXCEEDED` |
| Unsupported provider    | `BAD_REQUEST`          |

---

# Phase 1 — Basic (MVP AI)

## Goals

- Deliver core AI-powered study features to subscribed users
- Maintain model-agnostic backend (OpenAI / Ollama)
- Introduce subscription-based access with usage controls
- Build the foundation for all future AI pipelines

## Scope

### Inputs

| Input             | Status                                                   |
| ----------------- | -------------------------------------------------------- |
| Text (chat input) | ✅                                                       |
| PDF upload        | ✅ exists — `pdfService.ts`, Buffer extraction, chunking |
| Text paste (raw)  | 🆕                                                       |

### AI Commands

| Command            | Status | Notes                                                                    |
| ------------------ | ------ | ------------------------------------------------------------------------ |
| `/flashcards pdf`  | 🗑️     | **Deprecated** — unified `/api/v1/ai/chat` with tool calling replaces this. Route kept for large PDF chunking until chat endpoint gains chunk support. |
| `/summary pdf`     | 🆕     |                                                                          |
| `/quiz pdf`        | 🆕     |                                                                          |
| `/explain pdf`     | 🆕     |                                                                          |
| `/flashcards text` | ✅     | Via `/api/v1/ai/chat` with tool calling                                  |
| `/summary text`    | 🆕     |                                                                          |
| `/quiz text`       | 🆕     |                                                                          |
| `/explain text`    | 🆕     |                                                                          |

### Chat Context

- Question-answering on uploaded document (text extracted via unpdf, injected into prompt)
- **Tool calling** — LLM uses `generate_flashcards` tool when flashcard intent detected
- **Client-side context hints** — CTA buttons set `context` field for server-side routing
- **Server-side keyword detection** — 50+ Polish/English morphological variants for flashcard intent
- Empty text allowed when file attached — enables "upload file, get flashcards" flow

## Existing Infrastructure Map

### What already works

| Component                                            | File                                                            | Description                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `LLMProvider` interface                              | `src/server/providers/LLMProvider.ts`                           | ✅ Active — `generateChat` accepts tools + toolChoice, returns `GenerateChatResult \| string`                              |
| `OpenAIProvider`                                     | `src/server/providers/openaiProvider.ts`                        | ✅ Active — tool calling support, passes tools in request body, parses `tool_calls` from response                          |
| `OllamaProvider`                                     | `src/server/providers/ollamaProvider.ts`                        | ✅ Active — text response only (no tool calling), updated interface                                                       |
| `OpenCodeProvider`                                   | `src/server/providers/opencodeProvider.ts`                      | ✅ Active — tool calling support (mimo-v2.5)                                                                              |
| `providerRegistry`                                   | `src/server/providers/providerRegistry.ts`                      | ✅ Active — routes to OpenAI/Ollama/OpenCode based on env vars                                                            |
| `models.config`                                      | `src/server/config/models.config.ts`                            | ✅ Active — env vars read by providers, config shape shared                                                             |
| `pdfService`                                         | `src/server/services/pdf.service.ts`                              | `extractText(buffer)` via **unpdf** + `chunkText(text)` + `suggestDeckName()` |
| `FlashcardGenerationService`                         | `src/server/services/flashcard-generation.service.ts`           | Orchestrates: extract -> chunk -> provider loop -> SSE callbacks                                                       |
| `FlashcardGenerationController`                      | `src/server/controllers/flashcard-generation.controller.ts`     | Validates language, delegates to service                                                                               |
| SSE route `POST /api/v1/flashcards/generate/frompdf` | `src/app/(backend)/api/v1/flashcards/generate/frompdf/route.ts` | 🗑️ **Deprecated** — unified `/api/v1/ai/chat` replaces this. Kept for large PDF chunking until chat endpoint gains chunk support. |
| `useGenerateFlashcards` hook                         | `src/hooks/use-flashcard-generation.ts`                         | 🗑️ **Deprecated** — client-side SSE reader for frompdf endpoint. Will be removed when frompdf is deleted.            |
| AI flashcard page                                    | `src/app/(frontend)/app/flashcards/ai/page.tsx`                 | 🗑️ **Deprecated** — dedicated PDF upload page. Will redirect to `/app/ai` when frompdf is deleted.                    |
| `UserRole` enum                                      | `src/types/index.ts`                                            | `FREE`, `PREMIUM`, `STUDENT`, `TEACHER`, `UNIVERSITY_ADMIN`, `SYS_ADMIN`                                               |
| Route middleware                                     | `src/proxy.ts` + `src/server/config/routes.config.ts`           | Auth check, role-based access                                                                                          |
| `authGuard`                                          | `src/server/guards/auth.guard.ts`                               | Simple authenticated check                                                                                             |

### What needs building for Phase 1

| Component                                   | Priority | Status | Reason                                                       |
| ------------------------------------------- | -------- | ------ | ------------------------------------------------------------ |
| General AI chat page                        | High     | ✅     | Built at `/app/ai` with markdown rendering, free scrolling   |
| Command parser                              | High     | ⚠️     | Keyword detection + context hints implemented, LLM-based pending |
| Usage tracking + subscription tables        | High     | 🆕     | No limits currently enforced                                 |
| `LLMGateway`                                | High     | ✅     | `callLLM` + `callLLMStreaming` with tool calling support     |
| `POST /ai/command`                          | High     | 🆕     | New multi-command endpoint                                   |
| `POST /api/v1/ai/chat`                      | High     | ✅     | Unified endpoint — chat + flashcards via tool calling        |
| `POST /api/v1/ai/flashcard-gen`             | High     | 🗑️     | **Deleted** — merged into `/api/v1/ai/chat`                  |
| `GET /ai/usage`                             | High     | 🆕     | Usage status for UI display                                  |
| `POST /api/v1/flashcards/generate/fromtext` | Medium   | 🗑️     | **Deprecated** — unified chat endpoint handles text input. Slated for deletion.  |
| Usage guard + subscription guard            | High     | ⚠️     | Stubs exist (`allowed: true`), real logic pending DB migration |

## Users & Access Model

| User Type                     | AI Access in F1                                                                                                              | Subscription Model                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Free** (`FREE` role)        | ❌ No access. Guard blocks all `/ai/*` routes. Phase 2+ possibility: cheapest provider, extreme limits (e.g., 1 request/day) | N/A                                                                                    |
| **Premium** (`PREMIUM` role)  | ✅ Full access, gated by subscription plan                                                                                   | **Basic / Pro / Max** — personal subscription, usage tracked per user                  |
| **Students** (`STUDENT` role) | Depends — mapped to their subscription tier or org plan                                                                      | Through university org subscription                                                    |
| **Teachers** (`TEACHER` role) | Depends — mapped to org plan                                                                                                 | Through university org subscription                                                    |
| **Organizations**             | Members inherit org's plan limits                                                                                            | **Basic / Business / Enterprise** — same limit structure, different names for branding |

### Subscription Plans

#### Premium (Individual)

| Plan      | Hourly    | Daily     | Monthly    | Ideal for        |
| --------- | --------- | --------- | ---------- | ---------------- |
| **Basic** | 10 req/h  | 50 req/d  | 500 req/m  | Casual learners  |
| **Pro**   | 40 req/h  | 200 req/d | 2000 req/m | Regular students |
| **Max**   | 100 req/h | 500 req/d | 5000 req/m | Power users      |

#### Organization

| Plan           | Hourly               | Daily                | Monthly               | Ideal for              |
| -------------- | -------------------- | -------------------- | --------------------- | ---------------------- |
| **Basic**      | 10 req/h per member  | 50 req/d per member  | 500 req/m per member  | Small study groups     |
| **Business**   | 40 req/h per member  | 200 req/d per member | 2000 req/m per member | University departments |
| **Enterprise** | 100 req/h per member | 500 req/d per member | 5000 req/m per member | Large institutions     |

> **Note:** Individual vs aggregate org tracking is TBD — the `usage_events` table records `user_id` (and optionally `org_id`), so either aggregation strategy works. Decision deferred to the team.

### Billing

Billing is out of scope for this document. It will be managed separately by the sales/billing system. Subscription plans are expected to be billed per-seat on a quarterly basis via the sales team.

## Technical Pipeline

### LLM Gateway Integration

The `LLMGateway` (see cross-cutting section above) replaces the need for a growing `LLMProvider` interface. Instead of adding a new method per command type, all pipelines call `callLLM({ prompt, systemPrompt, responseFormat }, ctx)` and handle the raw response.

Each command defines its own prompt constant (e.g., `SUMMARY_PROMPT`, `QUIZ_PROMPT`, `EXPLAIN_PROMPT`) and calls `callLLM` with it. Provider selection and token tracking are handled by the gateway automatically.

### Command Parser

```typescript
// src/server/ai/command-parser.ts  🆕
type ParsedCommand = {
  command: 'flashcards' | 'summary' | 'quiz' | 'explain' | 'chat';
  inputType: 'pdf' | 'text' | 'youtube';
  parameters: Record<string, unknown>;
};

function parseCommand(text: string): ParsedCommand;
```

Two tiers of detection:

1. **Explicit** — `/flashcards pdf`, `/summary text`, etc. (regex match)
2. **Implicit** — LLM-based intent detection when no slash command is present: "summarize this PDF" -> `{ command: 'summary', inputType: 'pdf' }`

### SSE Streaming (existing pattern to replicate)

The `POST /api/v1/ai/chat` route is the canonical pattern for new streaming endpoints. The legacy `frompdf/route.ts` follows the same structure but is **deprecated**.

```typescript
const encoder = new TextEncoder();
const stream = new ReadableStream({
  async start(controller) {
    const send = (event: string, data: unknown) => {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    };
    try {
      await pipeline(input, callbacks);
    } catch (error) {
      send('error', { message: formatError(error) });
      controller.close();
    }
  },
});
return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  },
});
```

Standard event types for all pipelines:
| Event | Payload | When |
|-------|---------|------|
| `token` | `{ text }` | Individual token during chat streaming |
| `flashcards` | `{ deckName, flashcards: [{ front, back, topic }] }` | Flashcard tool call result (includes deck name from LLM) |
| `result` | `{ type, data }` | Partial result (e.g., 3 flashcards from PDF pipeline) |
| `progress` | `{ processedChunks, totalChunks }` | After each chunk (PDF pipeline only) |
| `complete` | `{ message }` | All processing done |
| `usage` | `{ current, limit, plan, resetsAt }` | Usage limit info (sent before complete) |
| `error` | `{ message }` | Any failure |

> **Note:** The `think` event was removed — tool calling replaced the THINK/JSON parsing approach. The `flashcards` event now always includes `deckName` from the LLM's tool call arguments.

### Architecture Diagram (Phase 1)

```
User -> AI Chat UI -> POST /api/v1/ai/chat { text, file?, context?, messages? }
  -> Auth guard (inline Supabase auth)
    -> Route-level validation (text required unless file attached)
      -> Keyword scan + context check
        |
        ├── [flashcard keyword OR context='flashcards']
        |     -> AiCommandController.chat(text, file, ctx)
        |       -> AiCommandService.chat(text, file, ctx)
        |         -> Server-side keyword re-check + file text extraction
        |           -> callLLM(prompt, systemPrompt, tools=[generate_flashcards], toolChoice)
        |             -> Parse tool_calls response -> { deckName, flashcards }
        |               -> SSE: flashcards { deckName, flashcards }, complete
        |
        └── [no flashcard intent]
              -> ChatController.chat(body, ctx)
                -> checkSubscription() + checkUsage()
                  -> ChatService.chat(text, file, messages, ctx)
                    -> callLLMStreaming(prompt, systemPrompt)
                      -> SSE: token, complete, usage -> UI

User -> POST /api/v1/flashcards/generate/frompdf [DEPRECATED — kept for large PDF chunking]
  -> Auth guard
    -> FlashcardGenerationController -> FlashcardGenerationService
      -> pdfService.extractText -> chunkText -> provider.generateFlashcardsFromChunk
        -> SSE: flashcards, progress, complete
```

**Key architectural change:** The separate `/api/v1/ai/flashcard-gen` endpoint was **deleted**. All flashcard generation now flows through `/api/v1/ai/chat` using OpenAI tool calling. The server detects intent via:
1. **Client-side context hint** (`context: 'flashcards'` sent when CTA button is clicked)
2. **Server-side keyword scan** (50+ Polish/English morphological variants)
3. **LLM auto-detection** (`tool_choice: 'auto'` lets the model decide when to use `generate_flashcards`)

## Data Model

Three new Supabase tables:

```sql
-- Track every AI call for usage and billing calculations
CREATE TABLE usage_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id),
  org_id        UUID REFERENCES organizations(id),   -- nullable, for org-level aggregation
  action_type   TEXT NOT NULL,             -- 'flashcards', 'summary', 'quiz', 'explain', 'chat'
  input_type    TEXT NOT NULL,             -- 'pdf', 'text'
  provider      TEXT NOT NULL,             -- 'openai', 'anthropic', 'google', 'groq', 'ollama'
  model         TEXT NOT NULL,             -- actual model name used (e.g. 'gpt-4o-mini')
  input_tokens  INT,                       -- tokens sent to provider
  output_tokens INT,                       -- tokens received from provider
  cost          INT NOT NULL DEFAULT 1,    -- abstract cost unit for plan limits
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast bracket queries
CREATE INDEX idx_usage_events_lookup
  ON usage_events(user_id, action_type, created_at);

-- Available subscription plans (seeded data)
CREATE TABLE subscription_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,            -- 'basic', 'pro', 'max', 'business', 'enterprise'
  category      TEXT NOT NULL,            -- 'premium' or 'org'
  hourly_limit  INT NOT NULL,
  daily_limit   INT NOT NULL,
  monthly_limit INT NOT NULL,
  price         DECIMAL(10,2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Active subscriptions for users
CREATE TABLE user_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id),
  plan_id       UUID NOT NULL REFERENCES subscription_plans(id),
  org_id        UUID REFERENCES organizations(id),   -- set if org-sponsored
  starts_at     TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Migration file: `supabase/migrations/YYYYMMDDHHMMSS_ai_subscriptions.sql`

### Subscription Guard

New file: `src/server/guards/subscription.guard.ts`

```typescript
async function checkSubscription(userId: string): Promise<{
  allowed: boolean;
  plan: SubscriptionPlan | null;
  reason?: string;
}>;

// Logic:
// 1. Look up user.role
// 2. If FREE -> return { allowed: false, reason: 'FREE_TIER_NO_AI' }
// 3. Look up active user_subscription for this user
// 4. If no active subscription -> return { allowed: false, reason: 'NO_ACTIVE_SUBSCRIPTION' }
// 5. If expired -> return { allowed: false, reason: 'SUBSCRIPTION_EXPIRED' }
// 6. Return { allowed: true, plan }
```

### Usage Guard

New file: `src/server/guards/usage.guard.ts`

```typescript
type UsageCheck = {
  allowed: boolean;
  current: { hourly: number; daily: number; monthly: number };
  limits: { hourly: number; daily: number; monthly: number };
  resetsAt: { hourly: string; daily: string; monthly: string };
};

async function checkUsage(
  userId: string,
  actionType: string,
  plan: SubscriptionPlan,
): Promise<UsageCheck>;

// Logic:
// 1. Query usage_events for this user + action_type in last 60 min -> hourly
// 2. Query usage_events for this user + action_type in last 24 h -> daily
// 3. Query usage_events for this user + action_type in last 30 d -> monthly
// 4. Compare each against plan limits
// 5. If any exceeded -> allowed: false
```

Called before any provider invocation. If a limit is exceeded, returns `USAGE_LIMIT_EXCEEDED` error via SSE. The error payload includes `current` and `limits` so the UI can show "Limit reset in 45 minutes."

The `GET /ai/usage` endpoint wraps both guards and returns the usage status for the current user.

## API Endpoints

### Phase 1 Endpoints

| Method | Path                                   | Status | Description                                                                                                       |
| ------ | -------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/flashcards/generate/frompdf`  | 🗑️     | **Deprecated** — unified chat endpoint replaces this. Kept for large PDF chunking until chat gains chunk support. |
| POST   | `/api/v1/flashcards/generate/fromtext` | 🗑️     | **Deprecated** — unified chat endpoint handles text input. Slated for deletion.                                   |
| POST   | `/api/v1/ai/chat`                      | ✅     | **Unified endpoint** — chat + flashcard generation via tool calling. Accepts `{ text, file?, context?, messages? }` |
| POST   | `/api/v1/ai/flashcard-gen`             | 🗑️     | **Deleted** — merged into `/api/v1/ai/chat`                                                                       |
| POST   | `/ai/command`                          | 🆕     | Universal command endpoint — accepts `{ text, file?, language? }`, detects intent, streams result                 |
| GET    | `/ai/usage`                            | 🆕     | Returns current usage stats and limits for user                                                                   |

Route rule added in `src/server/config/routes.config.ts`:

```typescript
{
  matcher: /^\/api\/v1\/ai(\/.*)?$/,
  requireAuth: true,
  allowedRoles: [UserRole.PREMIUM, UserRole.STUDENT, UserRole.TEACHER],
  isApi: true,
},
```

> Note: `FREE` is intentionally omitted. The subscription guard provides a second layer of protection even if the route rule is bypassed.

### Key files

| File | Purpose |
|------|---------|
| `src/server/ai/llm-gateway.ts` | `callLLM` + `callLLMStreaming` with provider routing and tool calling |
| `src/server/ai/ai.types.ts` | `ToolDefinition`, `ToolCall`, `LLMGatewayRequest/Response` types |
| `src/server/services/ai-command.service.ts` | Flashcard tool definition, keyword detection, `generate_flashcards()` + `chat()` |
| `src/server/controllers/ai-command.controller.ts` | Routes to service, emits SSE events |
| `src/app/(backend)/api/v1/ai/chat/route.ts` | Unified endpoint — keyword scan + context routing |
| `src/hooks/use-ai-chat.ts` | Client hook — context hints, `sendLocalResponse`, SSE parsing |
| `src/components/ai/ai-chat-screen.tsx` | Main UI — scroll management, CTA context, file handling |
| `src/components/ai/flashcard-block.tsx` | Flashcard preview grid — editable deck name, batch save |
| `src/server/services/pdf.service.ts` | PDF extraction via `unpdf` (previously `pdfjs-dist`) |

## Frontend — AI Chat Page

New page: `src/app/(frontend)/app/ai/page.tsx`

### Layout

```
+-------------------------------------------------+
|  AI Assistant                        [Usage ⚡] |
+-------------------------------------------------+
|                                                 |
|  +-----------------------------------------+    |
|  | User:  /flashcards pdf from this        |    |
|  +-----------------------------------------+    |
|  +-----------------------------------------+    |
|  | AI:   Generating flashcards...          |    |
|  |       [##########] 6/12 chunks          |    |
|  +-----------------------------------------+    |
|  +-----------------------------------------+    |
|  | Q: What is X?   A: X is...             |    |
|  | Q: How does Y?  A: Y works by...       |    |
|  +-----------------------------------------+    |
|                                                 |
+-------------------------------------------------+
|  [Upload PDF]  [Type a message...]        [Send] |
|  [Paste text]                                    |
+-------------------------------------------------+
```

### Components

| Component        | Status | Purpose                                                                                                     |
| ---------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `ChatInput`      | ✅     | Text input + file upload + send button                                                                      |
| `ChatMessage`    | ✅     | Single message bubble — user text, AI markdown rendering (when complete), plain text (during streaming)      |
| `ChatHistory`    | ✅     | Scrollable message list (parent manages auto-scroll)                                                        |
| `UsageBadge`     | ✅     | Shows "15/50 daily requests used" + plan name                                                               |
| `FlashcardBlock` | ✅     | Scrollable 2-column grid, editable deck name, per-card delete, batch save                                   |
| `ThinkingBlock`  | ✅     | Collapsible thinking traces panel with step animation                                                       |
| `AiChatGreeting` | ✅     | CTA buttons with local fake responses (no LLM call)                                                         |

### Hook

`src/hooks/use-ai-chat.ts` ✅ — unified chat + flashcard generation hook:

- **All messages go to `/api/v1/ai/chat`** — no separate endpoint routing
- **Client-side context hints** — `sendMessage(text, file, context)` passes `context` field (e.g., `'flashcards'`) to server for intent routing
- **`sendLocalResponse(userText, assistantText)`** — adds messages without LLM call (used for CTA greeting responses)
- **Reads SSE stream generically** — handles `token`, `flashcards` (with `deckName`), `result`, `complete`, `usage`, `error` events
- **Manages message history state** with `thinkingTraces` field and `result` field (typed by result type)
- **Tracks streaming status** per message (`sending`, `streaming`, `thinking`, `complete`, `error`)
- **File handling** — chunked base64 conversion (avoids stack overflow on large files), passes file to server

---

# Phase 2 — V2 (Extended AI Module)

## Goals

- Add new input types (YouTube, images, audio, DOCX, TXT, ZIP)
- Introduce modular command architecture
- Enable advanced content processing
- Implement Tutor Mode
- Improve UX with context memory and smart pipelines

## New Input Types

| Type        | Processor                          | Technology                                |
| ----------- | ---------------------------------- | ----------------------------------------- |
| YouTube URL | `youtube-transcript-service.ts` 🆕 | `ytdl-core` or YouTube Data API v3        |
| Image       | `ocr-service.ts` 🆕                | Tesseract.js or vision-capable LLM        |
| Audio       | `asr-service.ts` 🆕                | Whisper API (OpenAI) or local Whisper.cpp |
| DOCX        | `docx-service.ts` 🆕               | `mammoth.js` or `docx`                    |
| TXT         | `text-service.ts` 🆕               | Direct read (trivial)                     |
| ZIP         | `zip-service.ts` 🆕                | `adm-zip` or `yauzl`, iterate entries     |

All processors follow a common interface:

```typescript
interface InputProcessor {
  type: InputType;
  extract(buffer: Buffer, metadata: Record<string, unknown>): Promise<ExtractedContent>;
}

interface ExtractedContent {
  text: string;
  metadata: Record<string, unknown>;
}
```

## Modular Command System

```typescript
// src/server/ai/modules/module.types.ts  🆕
interface AIModule {
  id: string;
  name: string;
  description: string;
  inputTypes: InputType[];
  systemPrompt: string;
  pipeline(input: ExtractedContent, callbacks: PipelineCallbacks): Promise<void>;
}
```

Module registry: `src/server/ai/modules/modules.config.ts` 🆕

Each module is a standalone file in `src/server/ai/modules/`:

| Module     | File                     | Input Types                          |
| ---------- | ------------------------ | ------------------------------------ |
| Flashcards | `flashcards.module.ts`   | pdf, text, docx, txt                 |
| Summary    | `summary.module.ts`      | pdf, text, docx, txt, youtube        |
| Quiz       | `quiz.module.ts`         | pdf, text, docx, txt                 |
| Explain    | `explain.module.ts`      | pdf, text, docx, txt                 |
| Mindmap    | `mindmap.module.ts` 🆕   | pdf, text, docx, txt, youtube        |
| Notes      | `notes.module.ts` 🆕     | pdf, text, docx, txt, youtube, audio |
| Translate  | `translate.module.ts` 🆕 | pdf, text, docx, txt                 |
| Compare    | `compare.module.ts` 🆕   | any (takes two inputs)               |
| Timeline   | `timeline.module.ts` 🆕  | pdf, text, docx, txt, youtube        |
| Lesson     | `lesson.module.ts` 🆕    | any                                  |

### Smart Pipelines

Single prompt with multiple intents: "Summarize this PDF and create flashcards from it" triggers both `/summary` and `/flashcards` sequentially on the same extracted text, streaming results in order.

Implementation: `smart-router.ts` 🆕 — uses LLM to classify intent from natural language when no slash command is present.

### Memory Context

| Storage          | Scope           | What's stored                                |
| ---------------- | --------------- | -------------------------------------------- |
| In-memory (Map)  | Current session | Last 5 documents, last 3 command invocations |
| Redis (optional) | Cross-session   | Session history per `sessionId`              |
| Database         | Persistent      | User preferences, saved outputs              |

New table:

```sql
CREATE TABLE ai_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id),
  context       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Supports follow-up commands like "Do the same for the next file" or "Explain this in simpler terms."

### AI Tutor Mode

New route: `POST /ai/tutor`

Interactive flow:

1. Student submits material -> AI generates questions
2. Student answers -> AI evaluates correctness
3. AI explains mistakes -> AI suggests improvements
4. Loop continues until student is satisfied

State machine per session:

```
IDLE -> QUESTIONING -> AWAITING_ANSWER -> EVALUATING -> FEEDBACK -> QUESTIONING | COMPLETE
```

### Guardrails

New file: `src/server/ai/guardrails.ts` 🆕

- **Content filter** — regex + keyword blocks for prohibited content
- **Prompt injection** — detect prompt overrides, system prompt leaks
- **Output validation** — ensure structured responses match expected schemas before delivering to user

### Usage Limits (V2)

Separate quotas per module type:
| Action Type | Basic | Pro | Max |
|-------------|-------|-----|-----|
| flashcards | 10/h | 40/h | 100/h |
| summary | 10/h | 40/h | 100/h |
| quiz | 10/h | 40/h | 100/h |
| explain | 20/h | 80/h | 200/h |
| tutor | 5/h | 20/h | 50/h |
| transcription | 3/h | 10/h | 30/h |
| mindmap / notes / etc. | 5/h | 20/h | 50/h |

Free users remain blocked in Phase 2 unless explicitly opted into extreme-cheap-provider mode.

### API Endpoints (V2)

| Method | Path                   | Description                                      |
| ------ | ---------------------- | ------------------------------------------------ |
| POST   | `/ai/module/:moduleId` | Execute a specific module by ID                  |
| POST   | `/ai/tutor`            | Tutor Mode — question -> answer -> feedback loop |
| GET    | `/ai/modules`          | List available modules with their input types    |

---

# Phase 3 — V3 (Advanced AI Pipeline)

## Goals

- Full AI learning ecosystem
- Automated educational workflows
- Multi-agent pipelines with quality verification
- Curriculum building and study plans

## AI Curriculum Builder

`POST /ai/curriculum/build`

Input: multiple source materials (PDFs, YouTube playlists, audio recordings, notes)

Output:

- Study plan with timeline
- Topic breakdown with difficulty estimates
- Generated flashcards, quizzes, and tests per module
- Suggested study schedule

Architecture:

```
Material Sources -> Classification Agent -> Topic Grouping Agent
  -> Difficulty Estimator -> Curriculum Generator -> Output Assembler
```

## AI Workflows

`POST /ai/workflow/execute`
`POST /ai/workflow/custom`

Users define pipelines as JSON:

```json
{
  "steps": [
    { "module": "extract", "source": "lecture1.pdf" },
    { "module": "summary", "input": "step-0" },
    { "module": "flashcards", "input": "step-0" },
    { "module": "quiz", "input": "step-1" },
    { "module": "test", "input": "step-2" }
  ]
}
```

Presets: "Exam Prep", "Lecture Notes", "Research Paper"
Queue: BullMQ or RabbitMQ for async execution
Error handling: retry per step, dead letter queue, partial success reporting

## Multi-Agent Pipelines

| Agent              | Role                                            | Prompt Focus          |
| ------------------ | ----------------------------------------------- | --------------------- |
| Extraction Agent   | Extracts key concepts, entities, relationships  | Information retrieval |
| Analysis Agent     | Identifies patterns, gaps, connections          | Critical thinking     |
| Generation Agent   | Creates study materials (flashcards, summaries) | Content creation      |
| Verification Agent | Validates accuracy, detects hallucinations      | Quality control       |

Each agent is a specialized LLM call with its own system prompt. Agents pass results through a shared context object.

## AI Reviewer

`POST /ai/review`

Scans generated content for:

- Factual errors
- Missing information
- Ambiguous statements
- Improvement suggestions

## Model Sandbox

Users select which model to use per session:
| Option | Provider |
|--------|----------|
| OpenAI GPT-4o-mini | openaiProvider (exists) |
| OpenAI GPT-4o | openaiProvider (configurable) |
| Anthropic Claude | new provider |
| Groq Llama | new provider |
| Local Ollama | ollamaProvider (exists) |

Results can be compared side-by-side in the UI.

## Integrations (Optional)

| Platform        | Integration                             |
| --------------- | --------------------------------------- |
| Notion          | Export AI-generated notes directly      |
| Google Drive    | Import documents for AI processing      |
| OneDrive        | Import documents for AI processing      |
| Canvas / Moodle | LMS integration — pull course materials |

## Usage Limits (V3)

| Action Type      | Basic | Pro   | Max       |
| ---------------- | ----- | ----- | --------- |
| workflow execute | 5/mo  | 20/mo | 100/mo    |
| curriculum build | 2/mo  | 5/mo  | 30/mo     |
| multi-agent      | 2/mo  | 10/mo | 50/mo     |
| review           | 20/d  | 100/d | unlimited |

## API Endpoints (V3)

| Method | Path                   | Description                           |
| ------ | ---------------------- | ------------------------------------- |
| POST   | `/ai/workflow/execute` | Run a predefined workflow preset      |
| POST   | `/ai/workflow/custom`  | Run a user-defined workflow           |
| POST   | `/ai/curriculum/build` | Build a full curriculum from sources  |
| POST   | `/ai/review`           | Review and validate generated content |

---

# Summary

| Area                     | Phase 1                                                                          | Phase 2                                              | Phase 3                                       |
| ------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- |
| **Inputs**               | Text, PDF                                                                        | YouTube, Image, Audio, DOCX, TXT, ZIP                | Multiple simultaneous sources                 |
| **Commands**             | flashcards, summary, quiz, explain                                               | mindmap, notes, translate, compare, timeline, lesson | workflows, curriculum                         |
| **Processing**           | **Tool calling** (unified endpoint) or single command → single output            | Smart pipelines, multi-intent                        | Multi-agent orchestration                     |
| **Context**              | Per-request, **client-side hints**                                               | Session memory (IndexedDB/server)                    | Full curriculum context                       |
| **Limits**               | Hourly / Daily / Monthly brackets                                                | Per-module limits, transcription caps                | Workflow, curriculum, institutional overrides |
| **Access**               | Free blocked, Premium + Org via subscription                                     | Same + opt-in free tier possible                     | Same + institutional plans                    |
| **Providers**            | **OpenAI, Ollama, OpenCode** (via LLMGateway with tool calling)                  | + Anthropic, Google, Groq                            | Model sandbox (via LLMGateway)                |
| **Frontend**             | Chat UI with SSE, **markdown rendering**, **free scrolling**, **CTA responses**  | Module selector, Tutor UI                            | Workflow builder, curriculum dashboard        |
| **Persistence**          | **Tier 1 (Ephemeral)** — chat in React state, flashcards saved to DB            | **Tier 2 (IndexedDB)** — local session history       | **Tier 3 (Server)** — tutor mode, event log   |
| **Existing code reused** | LLMGateway, pdfService (unpdf), SSE pattern, UserRole, auth guard, middleware    | Same + Phase 1                                       | Same + Phase 1+2                              |

---

# Session Persistence — Privacy-First Progressive Model

## Philosophy

> **"Privacy-First, Progressive Persistence"** — Let the user choose their level of commitment, from anonymous to fully persistent, while defaulting to privacy.

## Three-Tier Hybrid Architecture

| Tier | Data Storage | Best For | UX Implication |
|------|-------------|----------|----------------|
| **1. Ephemeral Session** | Browser memory (RAM) only | Quick, anonymous tasks. Guest users. | "Live sandbox" — lost on refresh. |
| **2. Local Persistence** | IndexedDB / localStorage | Registered users wanting device-only history. | "My study notes on this device." |
| **3. Account Sync** | Server database (Supabase) | Cross-device access, long-term progress, tutor mode. | "My persistent learning profile." |

## How This Applies to StudiQ

### Current Implementation (Tier 1 — Ephemeral)

The AI chat currently operates at **Tier 1**:
- Chat history lives in React state (`useAiChat` hook)
- Lost on page refresh or navigation
- No data sent to server beyond the current message
- File content extracted server-side, not stored

**This is correct for the current phase** — no persistence needed yet.

### Future: Tier 2 — Local Persistence

When users want to revisit study sessions without an account:

**Implementation approach:**
- Use **IndexedDB** (not localStorage) for larger structured data (chat histories, flashcard sets)
- Clear UI toggle: `"💾 Save this session to your browser? This keeps your history on this device only."`
- On each API call, manage chat history client-side and persist if user opts in
- Never send raw chat history to AI provider — only relevant prompt/context per request

**When to build:** When user feedback indicates frustration about losing sessions on refresh.

### Future: Tier 3 — Account Sync (Tutor Mode)

Requires server-side persistence. A tutor must remember:

- **Learning history** — topics covered, where student struggled
- **Performance data** — quiz results, skill levels, proficiency scores
- **Personal preferences** — learning style, pace, preferred language

**Implementation approach — Event sourcing:**

Don't store raw chat logs. Store structured events:

```json
{
  "userId": "abc123",
  "timestamp": "...",
  "event": "concept_mastered",
  "payload": {
    "topic": "calculus/integration_by_parts",
    "proficiency": 0.85,
    "sessionId": "client-side-session-id"
  }
}
```

**Benefits:**
- GDPR-friendly (structured data, not conversational)
- Lean database (events are small, chat logs are not)
- Enables analytics ("student improved 20% on topic X over 3 sessions")
- Powers tutor mode recommendations

**Migration path:** When a user creates an account, offer to migrate their local Tier 2 history to Tier 3 server sync.

### Future: Tier 3 — AI API Integration

Stateless at the AI API level, stateful at the application level:

```
User asks: "Create 5 flashcards on mitochondria."
  -> Server sends structured prompt to AI API (no session ID)
  -> AI returns JSON-structured flashcards
  -> Server saves output to database, tied to user/account
```

**The AI API remains a pure function** (prompt → response). All persistence and state logic lives in the backend.

## Privacy Recommendations

1. **Be transparent** — Show users what is stored where:
   ```
   Your Learning Data:
     ✅ Study sessions on this device: 3
     ✅ Saved flashcard sets: 2
     ⚠️ Server-side learning profile (account needed): Not yet created
   ```

2. **Offer data export/delete** — Critical for GDPR compliance and user trust.

3. **Smart defaults:**
   - Guest users → ephemeral (Tier 1)
   - Signed-in users → local persistence with option to sync (Tier 2 → Tier 3)

4. **Never rely on client-side data for critical features** like tutor mode progress — always have a server-side source of truth.

## Current State

| Feature | Tier | Notes |
|---------|------|-------|
| AI chat history | 1 (Ephemeral) | React state, lost on refresh |
| Flashcard decks | 3 (Account Sync) | Saved to Supabase, user-scoped |
| PDF processing | 1 (Ephemeral) | Text extracted, not stored |
| File uploads | 1 (Ephemeral) | Base64 in request, not persisted |

---

# Implementation Order (Phase 1)

1. **Create DB migration** — `usage_events`, `subscription_plans`, `user_subscriptions` tables
2. **Seed subscription plans** — Basic / Pro / Max / Business / Enterprise
3. **Build `subscription.guard.ts`** — block FREE, check active plan
4. **Build `usage.guard.ts`** — bracket limit checks
5. **Build `LLMGateway`** — `src/server/ai/llm-gateway.ts` with `callLLM()` + provider routing + token tracking + usage recording
6. **Build `command-parser.ts`** — regex + LLM intent detection
7. **Build `POST /ai/command`** — universal streaming endpoint (reuse SSE pattern from `POST /api/v1/ai/chat`)
8. **Build `POST /api/v1/ai/chat`** — free-form chat with context, SSE
9. **Build `POST /api/v1/ai/flashcard-gen`** — text -> flashcards with thinking traces, SSE
10. **Build AI chat page** — `src/app/(frontend)/app/ai/page.tsx` with components
11. **~~Add `POST /api/v1/flashcards/generate/fromtext`~~** — 🗑️ Deprecated, unified chat endpoint handles text input
12. **Add `/api/v1/ai/*` route rules** to `routes.config.ts`

### Completed steps

| Step | Status | Notes |
|------|--------|-------|
| 5 (LLMGateway) | ✅ | `callLLM` + `callLLMStreaming` with provider resolution, **tool calling support** (`tools`, `toolChoice` params) |
| 8 (chat endpoint) | ✅ | `/api/v1/ai/chat` — unified endpoint for chat + flashcard generation via tool calling |
| 9 (flashcard-gen) | ✅ | **Merged into chat endpoint** — deleted `/api/v1/ai/flashcard-gen`. Flashcards now generated via `generate_flashcards` tool call |
| 10 (chat page) | ✅ | Full page at `/app/ai` with all components, **markdown rendering**, **free scrolling with chevron**, **CTA local responses** |
| 12 (route rules) | ✅ | `/api/v1/ai/*` — PREMIUM, STUDENT, TEACHER |
| 3 (subscription guard) | ⚠️ | Stub returns `allowed: true`, real logic pending DB migration |
| 4 (usage guard) | ⚠️ | Stub returns `allowed: true`, real logic pending DB migration |

### Additional completions (outside original plan)

| Feature | Status | Notes |
|---------|--------|-------|
| **OpenAI tool calling** | ✅ | `generate_flashcards` tool defined, `tool_choice` support, response parsing for `tool_calls` |
| **Client-side context hints** | ✅ | CTA clicks set `context` field (`'flashcards'`, etc.), server routes based on it |
| **Expanded Polish keywords** | ✅ | 50+ morphological variants for flashcard intent detection |
| **unpdf PDF extraction** | ✅ | Replaced `pdfjs-dist` direct import with `unpdf` — fixes Turbopack bundling |
| **Batch flashcard save** | ✅ | `POST /api/v1/flashcards/batch/create` instead of N sequential POSTs |
| **Flashcard preview redesign** | ✅ | Scrollable 2-column grid, editable deck name, per-card delete toggle |
| **3D flip animation** | ✅ | Figma version in session, direction-aware exit (left for Again/Hard, right for Good/Easy) |
| **Dashboard stats** | ✅ | Drop avg score, add flashcard accuracy with Layers icon, fix API response unwrapping |
| **File handling fixes** | ✅ | Chunked base64 (stack overflow fix), file data passed through to flashcard flow |
| **CTA local responses** | ✅ | Greeting clicks show predefined assistant message, no LLM call |
| **Free scrolling** | ✅ | User can scroll up during streaming, auto-scroll only when at bottom (50px threshold) |
| **Markdown rendering** | ✅ | Assistant messages rendered via `MarkdownRenderer` when complete, plain text during streaming |
| **Comprehensive logging** | ✅ | All AI routes log keyword detection, routing, LLM calls, tool calls, parsed results |
