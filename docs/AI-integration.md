# AI Integration Specification

This document describes the phased development of the AI subsystem for the StudiQ educational platform. Each phase builds on the previous one.

**Organization:**
- **Phase 1 (Basic/MVP)** — core AI features, usage controls, chat interface
- **Phase 2 (V2)** — new input types, modular commands, Tutor Mode
- **Phase 3 (V3)** — multi-agent pipelines, curriculum builder, workflows

---

## Legend

| Icon | Meaning |
|------|---------|
| ✅ | Already implemented in codebase |
| ⚠️ | Partially implemented, needs extension |
| 🆕 | Not yet built |

---

# Phase 1 — Basic (MVP AI)

## Goals
- Deliver core AI-powered study features to subscribed users
- Maintain model-agnostic backend (OpenAI / Ollama)
- Introduce subscription-based access with usage controls
- Build the foundation for all future AI pipelines

## Scope

### Inputs
| Input | Status |
|-------|--------|
| Text (chat input) | 🆕 |
| PDF upload | ✅ exists — `pdfService.ts`, Buffer extraction, chunking |
| Text paste (raw) | 🆕 |

### AI Commands
| Command | Status |
|---------|--------|
| `/flashcards pdf` | ⚠️ exists — only `frompdf` route, hardcoded to flashcards |
| `/summary pdf` | 🆕 |
| `/quiz pdf` | 🆕 |
| `/explain pdf` | 🆕 |
| `/flashcards text` | 🆕 — variant without PDF |
| `/summary text` | 🆕 |
| `/quiz text` | 🆕 |
| `/explain text` | 🆕 |

### Chat Context
- Question-answering on uploaded document
- Basic intent detection — user types "create flashcards from this" and system routes accordingly

## Existing Infrastructure Map

### What already works

| Component | File | Description |
|-----------|------|-------------|
| `LLMProvider` interface | `src/server/providers/LLMProvider.ts` | Defines `generateFlashcardsFromChunk()` + JSON repair utilities + `FLASHCARD_PROMPT` |
| `OpenAIProvider` | `src/server/providers/openaiProvider.ts` | Implements `LLMProvider`, calls OpenAI chat completions with `response_format: json_object` |
| `OllamaProvider` | `src/server/providers/ollamaProvider.ts` | Implements `LLMProvider`, calls Ollama generate |
| `providerRegistry` | `src/server/providers/providerRegistry.ts` | Factory — selects provider based on `LLM_PROVIDER` env var |
| `models.config` | `src/server/config/models.config.ts` | Reads `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_NAME` from `.env` |
| `pdfService` | `src/server/services/pdfService.ts` | `extractText(buffer)` via pdfjs-dist + `chunkText(text, minWords=500, maxWords=800, overlap=50)` + `suggestDeckName()` |
| `FlashcardGenerationService` | `src/server/services/flashcard-generation.service.ts` | Orchestrates: extract -> chunk -> provider loop -> SSE callbacks |
| `FlashcardGenerationController` | `src/server/controllers/flashcard-generation.controller.ts` | Validates language, delegates to service |
| SSE route `POST /api/v1/flashcards/generate/frompdf` | `src/app/(backend)/api/v1/flashcards/generate/frompdf/route.ts` | ReadableStream + TextEncoder — SSE events: `flashcards`, `progress`, `complete`, `error` |
| `useGenerateFlashcards` hook | `src/hooks/use-flashcard-generation.ts` | Client-side SSE reader with AbortController |
| AI flashcard page | `src/app/(frontend)/app/flashcards/ai/page.tsx` | PDF upload -> generate -> review/edit -> save to deck |
| `UserRole` enum | `src/types/index.ts` | `FREE`, `PREMIUM`, `STUDENT`, `TEACHER`, `UNIVERSITY_ADMIN`, `SYS_ADMIN` |
| Route middleware | `src/proxy.ts` + `src/server/config/routes.config.ts` | Auth check, role-based access |
| `authGuard` | `src/server/guards/auth.guard.ts` | Simple authenticated check |

### What needs building for Phase 1

| Component | Priority | Reason |
|-----------|----------|--------|
| General AI chat page | High | Only dedicated flashcard AI page exists |
| Command parser | High | Current route is hardcoded to flashcards |
| Usage tracking + subscription tables | High | No limits currently enforced |
| `LLMProvider` extension | High | Only `generateFlashcardsFromChunk` exists |
| `POST /ai/command` | High | New multi-command endpoint |
| `POST /ai/chat` | High | Free-form chat endpoint |
| `GET /ai/usage` | High | Usage status for UI display |
| `POST /api/v1/flashcards/generate/fromtext` | Medium | Text variant missing |
| Usage guard + subscription guard | High | Enforce access and limits before provider call |

## Users & Access Model

| User Type | AI Access in F1 | Subscription Model |
|-----------|----------------|-------------------|
| **Free** (`FREE` role) | ❌ No access. Guard blocks all `/ai/*` routes. Phase 2+ possibility: cheapest provider, extreme limits (e.g., 1 request/day) | N/A |
| **Premium** (`PREMIUM` role) | ✅ Full access, gated by subscription plan | **Basic / Pro / Max** — personal subscription, usage tracked per user |
| **Students** (`STUDENT` role) | Depends — mapped to their subscription tier or org plan | Through university org subscription |
| **Teachers** (`TEACHER` role) | Depends — mapped to org plan | Through university org subscription |
| **Organizations** | Members inherit org's plan limits | **Basic / Business / Enterprise** — same limit structure, different names for branding |

### Subscription Plans

#### Premium (Individual)

| Plan | Hourly | Daily | Monthly | Ideal for |
|------|--------|-------|---------|-----------|
| **Basic** | 10 req/h | 50 req/d | 500 req/m | Casual learners |
| **Pro** | 40 req/h | 200 req/d | 2000 req/m | Regular students |
| **Max** | 100 req/h | 500 req/d | 5000 req/m | Power users |

#### Organization

| Plan | Hourly | Daily | Monthly | Ideal for |
|------|--------|-------|---------|-----------|
| **Basic** | 10 req/h per member | 50 req/d per member | 500 req/m per member | Small study groups |
| **Business** | 40 req/h per member | 200 req/d per member | 2000 req/m per member | University departments |
| **Enterprise** | 100 req/h per member | 500 req/d per member | 5000 req/m per member | Large institutions |

> **Note:** Individual vs aggregate org tracking is TBD — the `usage_events` table records `user_id` (and optionally `org_id`), so either aggregation strategy works. Decision deferred to the team.

### Billing

Billing is out of scope for this document. It will be managed separately by the sales/billing system. Subscription plans are expected to be billed per-seat on a quarterly basis via the sales team.

## Technical Pipeline

### LLM Provider Extension

Current interface:
```typescript
// src/server/providers/LLMProvider.ts
interface LLMProvider {
  generateFlashcardsFromChunk(chunk: string, language: string): Promise<GeneratedFlashcard[]>;
}
```

Extended interface:
```typescript
// Phase 1 additions
interface LLMProvider {
  generateFlashcardsFromChunk(chunk: string, language: string): Promise<GeneratedFlashcard[]>;
  generateSummary(document: string, language: string): Promise<string>;
  generateQuiz(chunk: string, language: string, count: number): Promise<QuizItem[]>;
  generateExplanation(chunk: string, language: string): Promise<string>;
  generateChatResponse(context: ChatContext, message: string): Promise<string>;
}
```

Each new method gets its own system prompt constant (e.g., `SUMMARY_PROMPT`, `QUIZ_PROMPT`, `EXPLAIN_PROMPT`) defined in `LLMProvider.ts`.

Both `OpenAIProvider` and `OllamaProvider` implement all new methods. If a method is temporarily unsupported by a provider (e.g., Ollama has weaker JSON mode), it can throw `NotImplementedError` and the service falls back to the other provider or returns a clear error.

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

The `frompdf/route.ts` file is the canonical pattern. All new streaming endpoints follow this structure:

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
  headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
});
```

Standard event types for all pipelines:
| Event | Payload | When |
|-------|---------|------|
| `progress` | `{ processedChunks, totalChunks }` | After each chunk |
| `result` | `{ type, data }` | Partial result (e.g., 3 flashcards) |
| `complete` | `{ summary, metadata }` | All processing done |
| `error` | `{ message, ref? }` | Any failure |

### Architecture Diagram (Phase 1)

```
User -> Chat UI -> POST /ai/command { text, file?, language? }
  -> Route Handler
    -> Auth guard (existing)
    -> Subscription guard (new) — block FREE, check active plan
      -> Usage guard (new) — check bracket limits
        -> Command parser (new)
          -> Pipeline (flashcards / summary / quiz / explain)
            -> Provider (OpenAI / Ollama)
              -> SSE stream -> UI
```

## Data Model

Three new Supabase tables:

```sql
-- Track every AI call for usage calculations
CREATE TABLE usage_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id),
  org_id        UUID REFERENCES organizations(id),   -- nullable, for org-level aggregation
  action_type   TEXT NOT NULL,   -- 'flashcards', 'summary', 'quiz', 'explain', 'chat'
  input_type    TEXT NOT NULL,   -- 'pdf', 'text'
  cost          INT NOT NULL DEFAULT 1,
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

async function checkUsage(userId: string, actionType: string, plan: SubscriptionPlan): Promise<UsageCheck>;

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

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| POST | `/api/v1/flashcards/generate/frompdf` | ✅ Existing | PDF -> flashcards, SSE |
| POST | `/api/v1/flashcards/generate/fromtext` | 🆕 Needs adding | Text -> flashcards, SSE |
| POST | `/ai/command` | 🆕 | Universal command endpoint — accepts `{ text, file?, language? }`, detects intent, streams result |
| POST | `/ai/chat` | 🆕 | Free-form chat with document context |
| GET | `/ai/usage` | 🆕 | Returns current usage stats and limits for user |

Route rules in `src/server/config/routes.config.ts` will need entries for `/ai/*` (not yet added):

```typescript
{
  matcher: /^\/ai(\/.*)?$/,
  requireAuth: true,
  allowedRoles: [UserRole.PREMIUM, UserRole.STUDENT, UserRole.TEACHER],
  isApi: true,
},
```

> Note: `FREE` is intentionally omitted. The subscription guard provides a second layer of protection even if the route rule is bypassed.

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

| Component | Path | Purpose |
|-----------|------|---------|
| `ChatInput` | 🆕 | Text input + file upload + send button |
| `ChatMessage` | 🆕 | Single message bubble (user vs AI), renders different result types (flashcards, summary text, quiz buttons) |
| `ChatHistory` | 🆕 | Scrollable message list |
| `UsageBadge` | 🆕 | Shows "15/50 daily requests used" + plan name |
| `FileUpload` | 🆕 | Drag & drop zone, file preview, remove button |

### Hook

New hook: `src/hooks/use-ai-chat.ts` — modeled after existing `useGenerateFlashcards` but general-purpose:

- Sends to `/ai/command` or `/ai/chat`
- Reads SSE stream generically (not hardcoded to `flashcards` event)
- Manages message history state
- Tracks streaming status per message

---

# Phase 2 — V2 (Extended AI Module)

## Goals
- Add new input types (YouTube, images, audio, DOCX, TXT, ZIP)
- Introduce modular command architecture
- Enable advanced content processing
- Implement Tutor Mode
- Improve UX with context memory and smart pipelines

## New Input Types

| Type | Processor | Technology |
|------|-----------|------------|
| YouTube URL | `youtube-transcript-service.ts` 🆕 | `ytdl-core` or YouTube Data API v3 |
| Image | `ocr-service.ts` 🆕 | Tesseract.js or vision-capable LLM |
| Audio | `asr-service.ts` 🆕 | Whisper API (OpenAI) or local Whisper.cpp |
| DOCX | `docx-service.ts` 🆕 | `mammoth.js` or `docx` |
| TXT | `text-service.ts` 🆕 | Direct read (trivial) |
| ZIP | `zip-service.ts` 🆕 | `adm-zip` or `yauzl`, iterate entries |

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

| Module | File | Input Types |
|--------|------|-------------|
| Flashcards | `flashcards.module.ts` | pdf, text, docx, txt |
| Summary | `summary.module.ts` | pdf, text, docx, txt, youtube |
| Quiz | `quiz.module.ts` | pdf, text, docx, txt |
| Explain | `explain.module.ts` | pdf, text, docx, txt |
| Mindmap | `mindmap.module.ts` 🆕 | pdf, text, docx, txt, youtube |
| Notes | `notes.module.ts` 🆕 | pdf, text, docx, txt, youtube, audio |
| Translate | `translate.module.ts` 🆕 | pdf, text, docx, txt |
| Compare | `compare.module.ts` 🆕 | any (takes two inputs) |
| Timeline | `timeline.module.ts` 🆕 | pdf, text, docx, txt, youtube |
| Lesson | `lesson.module.ts` 🆕 | any |

### Smart Pipelines

Single prompt with multiple intents: "Summarize this PDF and create flashcards from it" triggers both `/summary` and `/flashcards` sequentially on the same extracted text, streaming results in order.

Implementation: `smart-router.ts` 🆕 — uses LLM to classify intent from natural language when no slash command is present.

### Memory Context

| Storage | Scope | What's stored |
|---------|-------|---------------|
| In-memory (Map) | Current session | Last 5 documents, last 3 command invocations |
| Redis (optional) | Cross-session | Session history per `sessionId` |
| Database | Persistent | User preferences, saved outputs |

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

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/module/:moduleId` | Execute a specific module by ID |
| POST | `/ai/tutor` | Tutor Mode — question -> answer -> feedback loop |
| GET | `/ai/modules` | List available modules with their input types |

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

| Agent | Role | Prompt Focus |
|-------|------|-------------|
| Extraction Agent | Extracts key concepts, entities, relationships | Information retrieval |
| Analysis Agent | Identifies patterns, gaps, connections | Critical thinking |
| Generation Agent | Creates study materials (flashcards, summaries) | Content creation |
| Verification Agent | Validates accuracy, detects hallucinations | Quality control |

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

| Platform | Integration |
|----------|-------------|
| Notion | Export AI-generated notes directly |
| Google Drive | Import documents for AI processing |
| OneDrive | Import documents for AI processing |
| Canvas / Moodle | LMS integration — pull course materials |

## Usage Limits (V3)

| Action Type | Basic | Pro | Max |
|-------------|-------|-----|-----|
| workflow execute | 5/mo | 20/mo | 100/mo |
| curriculum build | 2/mo | 5/mo | 30/mo |
| multi-agent | 2/mo | 10/mo | 50/mo |
| review | 20/d | 100/d | unlimited |

## API Endpoints (V3)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/workflow/execute` | Run a predefined workflow preset |
| POST | `/ai/workflow/custom` | Run a user-defined workflow |
| POST | `/ai/curriculum/build` | Build a full curriculum from sources |
| POST | `/ai/review` | Review and validate generated content |

---

# Summary

| Area | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|
| **Inputs** | Text, PDF | YouTube, Image, Audio, DOCX, TXT, ZIP | Multiple simultaneous sources |
| **Commands** | flashcards, summary, quiz, explain | mindmap, notes, translate, compare, timeline, lesson | workflows, curriculum |
| **Processing** | Single command -> single output | Smart pipelines, multi-intent | Multi-agent orchestration |
| **Context** | Per-request | Session memory (Redis/DB) | Full curriculum context |
| **Limits** | Hourly / Daily / Monthly brackets | Per-module limits, transcription caps | Workflow, curriculum, institutional overrides |
| **Access** | Free blocked, Premium + Org via subscription | Same + opt-in free tier possible | Same + institutional plans |
| **Providers** | OpenAI, Ollama | Same | Anthropic, Groq, model sandbox |
| **Frontend** | Chat UI with SSE | Module selector, Tutor UI | Workflow builder, curriculum dashboard |
| **Existing code reused** | LLMProvider, pdfService, SSE pattern, UserRole, auth guard, middleware | Same + Phase 1 | Same + Phase 1+2 |

---

# Implementation Order (Phase 1)

1. **Create DB migration** — `usage_events`, `subscription_plans`, `user_subscriptions` tables
2. **Seed subscription plans** — Basic / Pro / Max / Business / Enterprise
3. **Build `subscription.guard.ts`** — block FREE, check active plan
4. **Build `usage.guard.ts`** — bracket limit checks
5. **Extend `LLMProvider` interface** — add `generateSummary`, `generateQuiz`, `generateExplanation`, `generateChatResponse`
6. **Implement new methods in providers** — OpenAI + Ollama
7. **Build `command-parser.ts`** — regex + LLM intent detection
8. **Build `POST /ai/command`** — universal streaming endpoint (reuse SSE pattern from `frompdf/route.ts`)
9. **Build `POST /ai/chat`** — free-form chat with context
10. **Build `GET /ai/usage`** — usage status endpoint
11. **Build AI chat page** — `src/app/(frontend)/app/ai/page.tsx` with components
12. **Add `POST /api/v1/flashcards/generate/fromtext`** — text variant
13. **Add `/ai/*` route rules** to `routes.config.ts`
