# Flashcard Generation — Testing Pipeline Plan

## Overview

Build a regression-testable pipeline for the AI flashcard generation feature.
The single-agent chat is inherently non-deterministic (LLM decides tool calls), but
the frontend transformation layer (`use-ai-chat.ts`) is pure — `useChat` output in,
`ChatMessage[]` out. That's where all recent bugs lived (markdown streaming status,
flashcard readOnly vs skeleton, plan step tracking). We test that layer exhaustively
with fixture-driven snapshot tests, then add component render and backend tests.

---

## Phase 1: Hook Transformation Tests (highest ROI)

### Why

`use-ai-chat.ts` is a `useMemo` that transforms `UiMessageRaw[]` → `ChatMessage[]`.
No IO, no React refs — just pure array/object mapping. Perfect for vitest with jsdom.
10 fixtures cover every regression we've hit + common flows.

### Setup

**File:** `__tests__/unit/hooks/use-ai-chat.test.ts`

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAiChat } from '@/hooks/use-ai-chat';

// Mock @ai-sdk/react
vi.mock('@ai-sdk/react', () => ({
  useChat: vi.fn(),
}));

// Mock DefaultChatTransport from 'ai'
vi.mock('ai', () => ({
  DefaultChatTransport: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  log: vi.fn(),
}));
```

### Fixture format

`__tests__/unit/hooks/fixtures/` — each file is a JSON object:

```json
{
  "name": "basic-direct-flashcards",
  "input": { "uiMessages": [...] },
  "expected": {
    "messages": [
      { "role": "user", "status": "complete" },
      { "role": "assistant", "status": "complete", "result": { "type": "flashcards", "readOnly": false } }
    ]
  }
}
```

Assert selectively (match by `role` + key fields) rather than deep-equal every
field (ids, timestamps, durations are non-deterministic).

### Test runner structure

```typescript
import fs from 'fs';
import path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');
const fixtureFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json'));

describe.each(fixtureFiles)('fixture: %s', (fixtureFile) => {
  it('produces expected message transformations', async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, fixtureFile), 'utf-8'));

    const mockUseChat = vi.mocked(useChat);
    mockUseChat.mockReturnValue({
      messages: fixture.input.uiMessages,
      status: 'ready',
      append: vi.fn(),
      stop: vi.fn(),
      setMessages: vi.fn(),
      reload: vi.fn(),
      error: undefined,
      data: undefined,
      id: 'test',
    });

    const { result } = renderHook(() => useAiChat());
    const { messages } = result.current;

    // Assert each expected message shape
    fixture.expected.messages.forEach((expectedMsg, i) => {
      const actual = messages[i];
      expect(actual.role).toBe(expectedMsg.role);
      expect(actual.status).toBe(expectedMsg.status);
      if (expectedMsg.result) {
        expect(actual.result?.type).toBe(expectedMsg.result.type);
        expect(actual.result?.readOnly).toBe(expectedMsg.result.readOnly);
        if (expectedMsg.result.deckName !== undefined) {
          expect(actual.result?.deckName).toBe(expectedMsg.result.deckName);
        }
      }
      if (expectedMsg.planCompleted !== undefined) {
        expect(actual.planCompleted).toBe(expectedMsg.planCompleted);
      }
      if (expectedMsg.completedSteps !== undefined) {
        expect(actual.completedSteps).toEqual(expectedMsg.completedSteps);
      }
    });
  });
});
```

### 10 Fixture Scenarios

See Appendix A below for the full 100 test cases.

| # | Fixture file | What it guards |
|---|-------------|----------------|
| 1 | `basic-direct-flashcards.json` | Simple `generate_flashcards` → `finish` without plan |
| 2 | `finish-with-flashcards-consolidated.json` | Multi-batch → `finish(type='flashcards')` produces `readOnly=false`, correct deckName |
| 3 | `intermediate-batch-readonly.json` | `generate_flashcards` before `finish` has `readOnly=true` |
| 4 | `markdown-streaming-stability.json` | Only last assistant message's last text part is `status:'streaming'`; previously complete messages stay `'complete'` |
| 5 | `plan-step-tracking.json` | Tool calls map to plan steps correctly, `finish` marks all complete, `completedSteps: [0,1,2]` |
| 6 | `finish-type-chat.json` | `finish(type='chat')` produces text assistant message, no flashcard result |
| 7 | `plan-with-webfetch.json` | Plan created, `webfetch` → `extract_concepts` → `generate_flashcards` → `finish` |
| 8 | `interrupted-generation.json` | User message between two batches → agent handles correctly, chain is not broken |
| 9 | `empty-stream.json` | Pure text response, no tool calls at all |
| 10 | `streaming-vs-complete-edge.json` | Messages with mixed complete/streaming parts — only last part of last assistant message is streaming |

### Dependencies to add

```bash
bun add -d @testing-library/react @testing-library/jest-dom jsdom
```

Add to `vitest.config.ts`:
```typescript
environment: {
  '^__tests__/unit/hooks/': 'jsdom',  // override for hooks dir
}
```

Or use `@vitest-environment jsdom` docblock per file (simpler).

---

## Phase 2: Component Render Tests

### Files to create

`__tests__/unit/components/`:

| File | What it tests |
|------|---------------|
| `flashcard-block.test.tsx` | Skeleton when `loading`, preview when `readOnly=true`, save button when `readOnly=false`, grid layout, deck name display |
| `plan-block.test.tsx` | Correct step status rendering (pending gray, in-progress spinner, completed sparkle), "2/5 completed" vs "All steps complete" |
| `chat-message.test.tsx` | Markdown renderer vs plain text based on `status`, correct component switching for result types |
| `chat-history.test.tsx` | React.memo prevents re-render on unrelated message changes, correct React.memo shallow comparison |

### Testing approach

Use `@testing-library/react` + `vi.mock` for child components. Render components with explicit props, assert DOM structure.

```typescript
import { render, screen } from '@testing-library/react';
import { FlashcardBlock } from '@/components/ai/flashcard-block';
import { describe, it, expect } from 'vitest';

describe('FlashcardBlock', () => {
  it('renders skeleton when loading', () => {
    const { container } = render(<FlashcardBlock loading={true} />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders preview when readOnly', () => {
    render(<FlashcardBlock
      flashcards={mockFlashcards}
      readOnly={true}
      deckName="Test Deck"
      count={5}
    />);
    expect(screen.queryByText('Save')).toBeNull(); // no save button
    expect(screen.getByText('Test Deck')).toBeTruthy();
  });

  it('renders save button when not readOnly', () => {
    render(<FlashcardBlock
      flashcards={mockFlashcards}
      readOnly={false}
      deckName="Test Deck"
      count={5}
    />);
    expect(screen.getByText('Save')).toBeTruthy();
  });
});
```

---

## Phase 3: Backend Controller/Service Tests

### Files to create

`__tests__/unit/controllers/ai-chat.controller.test.ts`
`__tests__/unit/services/ai-chat.service.test.ts`

Follow existing patterns:
- Mock services at module level (`vi.mock`)
- Mock `createClient` from `@/lib/supabase/server`
- Use `mockSupabaseClient()` helper
- Test input validation (Zod schema), error wrapping, success paths

### What to test

- Controller: Valid request → calls service → returns `ControllerResponse`
- Controller: Invalid request body → returns `422` with Zod issues
- Service: `createClient` failure → `mapSupabaseError`
- Service: DB insert success → returns record
- Service: Business logic edge cases (empty input, too many cards, etc.)

---

## Phase 4: Replay Capture Pipeline (optional, higher-effort)

### Concept

Record production (dev) traffic as fixtures, then replay through the same
transformation layer to detect regressions.

### Capture mechanism

```typescript
// In use-ai-chat.ts, behind NEXT_PUBLIC_ENABLE_RECORDING flag:
useEffect(() => {
  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_ENABLE_RECORDING) {
    // After each update, push raw uiMessages + derived messages to window.__AI_CHAT_RECORDINGS__
    window.__AI_CHAT_RECORDINGS__ = window.__AI_CHAT_RECORDINGS__ || [];
    window.__AI_CHAT_RECORDINGS__.push({
      timestamp: Date.now(),
      scenario: 'live-capture',
      input: { uiMessages: rawMessages },
      output: { messages: transformedMessages },
    });
  }
}, [isStreaming, messages]);
```

Then export:
```typescript
// In the browser console:
copy(JSON.stringify(window.__AI_CHAT_RECORDINGS__, null, 2));
```

Paste into `__tests__/unit/hooks/fixtures/captured-{date}.json`.
Run the same test runner against it.

### Automated replay script

```bash
# scripts/replay-fixtures.sh
bunx vitest run __tests__/unit/hooks/ --reporter=verbose
```

---

## Execution Order & Effort

| Phase | What | Est. time | Depends on |
|-------|------|-----------|------------|
| 1 | Hook transformation tests + 10 fixtures | 30-45 min | None |
| 2 | Component render tests (4 files) | 1-2 h | Phase 1 fixture patterns |
| 3 | Backend controller/service tests (2 files) | 30 min | Existing test patterns |
| 4 | Replay pipeline | 2-3 h | Phase 1 runner, manual captures |

Do **Phase 1 first** — it catches the regression class we've actually hit.
Add `bun test:hooks` to package.json scripts.

---

## Appendix A: 100 Flashcard Generation Test Routes

### A. Happy Path — Direct Generation (10)

1. "Make 10 flashcards about the solar system" → `generate_flashcards` → `finish`
2. "Create 20 flashcards about World War 2 dates" → `generate_flashcards` → `finish`
3. "Generate flashcards for French vocabulary, 15 cards" → `generate_flashcards` → `finish`
4. "Fiszki z tabliczki mnożenia, 30 sztuk" → `generate_flashcards` → `finish`
5. "Make flashcards about JavaScript array methods" → `generate_flashcards` → `finish`
6. "Create anatomy flashcards: bones of the human body" → `generate_flashcards` → `finish`
7. "Generate 5 flashcards about the water cycle" → `generate_flashcards` → `finish`
8. "Stwórz fiszki z czasowników nieregularnych, 20 sztuk" → `generate_flashcards` → `finish`
9. "Make flashcards about Python data types" → `generate_flashcards` → `finish`
10. "Generate 12 flashcards about major world rivers" → `generate_flashcards` → `finish`

### B. Multi-Batch / Large Requests (8)

11. "Make 500 flashcards about US history" → plan → batch1 → ask_user → batch2 → ask_user → ... → finish(consolidated)
12. "1000 English vocabulary flashcards" → plan → 5 batches of 200 → finish(consolidated)
13. "300 flashcards about chemistry elements" → plan → 3 batches → finish
14. "Create 2000 flashcards for medical terminology" → plan → ~10 batches → finish
15. "Make 50 flashcards about Shakespeare plays" → (single batch, within limit) → finish
16. "250 flashcards about programming languages" → plan → 2 batches → finish
17. "Fiszki z biologii, 150 sztuk" → plan → batch → ask_user → continue → finish
18. "800 flashcards about world geography" → plan → 4 batches of 200 → finish

### C. Language Switching (8)

19. "Make flashcards about photosynthesis" → English → `generate_flashcards` → `finish`
20. "Stwórz fiszki o fotosyntezie" → Polish → `generate_flashcards` → `finish`
21. "Genera flashcards about photosynthesis" → mixed Polish/English → respond in Polish
22. "Create flashcards" → then switch language mid-conversation
23. "Generuj fiszki" → agent responds in Polish → user switches to English
24. "Make flashcards about German grammar" → English request, German content
25. "Fiszki z angielskiego: phrasal verbs" → Polish request, English content
26. User writes in unsupported language → agent responds in English

### D. File Upload + Processing (8)

27. Upload PDF → "Make flashcards from this file" → `fetch_material` → `extract_concepts` → `generate_flashcards` → `finish`
28. Upload text file → "Create 20 flashcards from this content" → same flow
29. Upload image → "Make flashcards about this diagram" → (tool may not support images)
30. Upload PDF → "Summarize and make flashcards" → mixed flow
31. Upload large PDF → "Extract key concepts and make 50 flashcards"
32. Upload file → user says "just the key terms" → `extract_concepts` → `generate_flashcards`
33. Upload malformed/corrupt file → error handling
34. Upload empty file → edge case

### E. URL Fetch + Processing (8)

35. "Go to wikipedia.org/wiki/Photosynthesis and make flashcards" → `webfetch` → `extract_concepts` → `generate_flashcards` → `finish`
36. "Make flashcards from this article: [URL]" → same flow
37. URL returns 404 → error handling
38. URL is a PDF link → `webfetch` returns binary → edge case
39. URL requires authentication → error handling
40. URL is very large (book-length) → truncation behavior
41. URL returns rate-limited → retry behavior
42. User provides multiple URLs → agent should handle sequentially

### F. Plan-Based Complex Flows (6)

43. "Research and create flashcards about quantum computing" → plan → webfetch → extract → generate → finish
44. "Make a comprehensive study set for the Civil War" → plan → fetch_material → extract → generate → finish
45. "Create flashcards for my biology exam, covering cells, genetics, and evolution" → plan → multi-topic
46. "I need to learn about the French Revolution, make flashcards" → plan → webfetch → extract → generate → ask_user → continue → finish
47. "Create flashcards from these notes and this URL" → plan → combine multiple sources
48. Complex plan with 6+ steps → `create_plan` called (4+ tools trigger it)

### G. User Interruptions / Redirects (8)

49. "Make 20 flashcards about..." → user interrupts "actually, make it about something else"
50. Agent starts generating → user says "stop" → agent stops
51. "Make flashcards" → user says "no, I meant explain this concept"
52. After batch 1 preview → user says "these are too easy, make harder ones"
53. After batch 1 → user says "change the format to multiple choice"
54. User asks a question mid-generation → agent should answer then continue
55. User rejects batch and wants to restart with different topic
56. User provides feedback on first batch → agent regenerates with improvements

### H. Error Recovery (8)

57. Network timeout during generation → retry mechanism
58. LLM API error → agent should fall back gracefully
59. `generate_flashcards` returns partial response → validation handling
60. Tool execution error → error message shown to user
61. Token limit exceeded → agent should split into batches
62. Rate limit hit → exponential backoff behavior
63. Tool call fails mid-plan → agent should recover/retry
64. Empty response from tool → agent should re-attempt

### I. Content Edge Cases (10)

65. "Make flashcards about a topic the model doesn't know well" → fetches material first
66. "Create exactly 1 flashcard" → minimum count edge case
67. "Create 200 flashcards" → exact batch limit
68. "Create 201 flashcards" → splits into batches of 200 + 1
69. "Make flashcards with very long front/back" → truncation behavior
70. "Generate flashcards with mathematical notation" → LaTeX rendering
71. "Create flashcards with code snippets" → code block formatting in markdown
72. "Make flashcards about abstract concepts" (e.g., justice, democracy)
73. "Create flashcards with emoji/Unicode content"
74. Single-word topic ("Japan", "DNA", "Pi") → agent should expand

### J. Tool-Specific Scenarios (8)

75. Agent calls `ask_user` for clarification → user responds → agent continues
76. Agent calls `create_plan` → executes steps → plan tracking updates in UI
77. Agent calls `evaluate_quality` → returns passed/failed (currently no-op)
78. Agent calls `fetch_material` → generates study content → extracts flashcards
79. Agent calls `webfetch` → extracts concepts → generates flashcards
80. Agent calls `finish(type='flashcards')` → consolidated view renders
81. Agent calls `finish(type='chat')` → text response renders
82. Agent calls multiple tools without plan (3 or fewer) → no plan triggered

### K. Edge Cases & Regressions (10)

83. Empty conversation → send empty message
84. Very long conversation history (20+ messages) → context window behavior
85. User sends only "?" or "..." → edge case input handling
86. User pastes very long text as input → context limits
87. Multiple users sharing same conversation → no issue (single-user)
88. Rapid-fire requests (user sends messages before agent finishes)
89. Browser refresh mid-stream → reconnection behavior (or lack thereof)
90. Switching tabs / app going to background → stream continues?
91. Agent uses `create_plan` with 10+ steps → UI rendering overflow
92. Agent generates 200 flashcards with very long text → card grid overflow

### L. Regression Test Suites (8)

93. Same request sent twice → should produce similar but not identical results
94. Regression: Markdown still renders correctly after streaming status fix
95. Regression: Plan is not instantly completed (step tracking works)
96. Regression: Flashcard skeleton has correct proportions
97. Regression: Previously completed messages don't flip to streaming
98. Regression: `finish` with flashcards renders consolidated view
99. Regression: Intermediate batches show readOnly = true (no save button)
100. Regression: Consolidated finish shows readOnly = false (save button)

---

## Appendix B: Detailed Fixture Shapes (Phase 1)

### Fixture 1: `basic-direct-flashcards.json`

```json
{
  "name": "basic-direct-flashcards",
  "input": {
    "uiMessages": [
      {
        "id": "user-1",
        "role": "user",
        "parts": [{ "type": "text", "text": "Make 5 flashcards about planets" }]
      },
      {
        "id": "assistant-1",
        "role": "assistant",
        "status": "complete",
        "parts": [
          {
            "type": "tool-call",
            "toolCallId": "tc-flash-1",
            "state": "call",
            "toolName": "generate_flashcards",
            "args": { "topic": "planets", "count": 5 }
          },
          {
            "type": "tool-result",
            "toolCallId": "tc-flash-1",
            "state": "result",
            "toolName": "generate_flashcards",
            "result": {
              "flashcards": [
                { "id": "fc-1", "front": "What is the largest planet?", "back": "Jupiter" },
                { "id": "fc-2", "front": "How many planets in the solar system?", "back": "8" },
                { "id": "fc-3", "front": "What planet is known as the Red Planet?", "back": "Mars" },
                { "id": "fc-4", "front": "Which planet is closest to the Sun?", "back": "Mercury" },
                { "id": "fc-5", "front": "What planet has the most moons?", "back": "Saturn (146 known)" }
              ],
              "count": 5
            }
          },
          {
            "type": "tool-call",
            "toolCallId": "tc-finish-1",
            "state": "call",
            "toolName": "finish",
            "args": {
              "type": "flashcards",
              "flashcards": [
                { "id": "fc-1", "front": "What is the largest planet?", "back": "Jupiter" },
                { "id": "fc-2", "front": "How many planets in the solar system?", "back": "8" },
                { "id": "fc-3", "front": "What planet is known as the Red Planet?", "back": "Mars" },
                { "id": "fc-4", "front": "Which planet is closest to the Sun?", "back": "Mercury" },
                { "id": "fc-5", "front": "What planet has the most moons?", "back": "Saturn (146 known)" }
              ],
              "deckName": "Planets"
            }
          },
          {
            "type": "tool-result",
            "toolCallId": "tc-finish-1",
            "state": "result",
            "toolName": "finish",
            "result": {
              "type": "flashcards",
              "data": [
                { "id": "fc-1", "front": "What is the largest planet?", "back": "Jupiter" },
                { "id": "fc-2", "front": "How many planets in the solar system?", "back": "8" },
                { "id": "fc-3", "front": "What planet is known as the Red Planet?", "back": "Mars" },
                { "id": "fc-4", "front": "Which planet is closest to the Sun?", "back": "Mercury" },
                { "id": "fc-5", "front": "What planet has the most moons?", "back": "Saturn (146 known)" }
              ],
              "deckName": "Planets",
              "count": 5
            }
          }
        ]
      }
    ]
  },
  "expected": {
    "messages": [
      { "role": "user", "status": "complete" },
      { "role": "tool_call", "toolName": "generate_flashcards", "status": "complete" },
      { "role": "assistant", "status": "complete", "result": {
        "type": "flashcards",
        "readOnly": false,
        "count": 5
      }},
      { "role": "tool_call", "toolName": "finish", "status": "complete" }
    ]
  }
}
```

### Fixture 4: `markdown-streaming-stability.json`

The critical regression fix. Only the last text part of the last assistant message
should have `status: 'streaming'`. All previous messages stay `'complete'`.

```json
{
  "name": "markdown-streaming-stability",
  "input": {
    "uiMessages": [
      {
        "id": "user-1",
        "role": "user",
        "parts": [{ "type": "text", "text": "Explain and make flashcards" }]
      },
      {
        "id": "assistant-text-1",
        "role": "assistant",
        "parts": [
          { "type": "text", "text": "Here is some explanation about the solar system. The sun is a star." },
          { "type": "tool-call", "toolCallId": "tc-f-1", "state": "call", "toolName": "generate_flashcards" },
          { "type": "tool-result", "toolCallId": "tc-f-1", "state": "result", "toolName": "generate_flashcards", "result": { "flashcards": [{ "id": "1", "front": "Q", "back": "A" }], "count": 1 } },
          { "type": "tool-call", "toolCallId": "tc-fi-1", "state": "call", "toolName": "finish" },
          { "type": "tool-result", "toolCallId": "tc-fi-1", "state": "result", "toolName": "finish", "result": { "type": "flashcards", "data": [{ "id": "1", "front": "Q", "back": "A" }], "deckName": "Test", "count": 1 } }
        ]
      },
      {
        "id": "user-2",
        "role": "user",
        "parts": [{ "type": "text", "text": "Tell me more" }]
      },
      {
        "id": "assistant-text-2",
        "role": "assistant",
        "parts": [
          { "type": "text", "text": "Currently streaming content..." }
        ]
      }
    ]
  },
  "expected": {
    "messages": [
      { "role": "user", "status": "complete" },
      { "role": "assistant", "status": "complete" },
      { "role": "user", "status": "complete" },
      { "role": "assistant", "status": "streaming" }
    ]
  }
}
```

---

## Appendix C: Test Runner Implementation Details

### Entry in `package.json`

```json
{
  "scripts": {
    "test:hooks": "vitest run __tests__/unit/hooks",
    "test:components": "vitest run __tests__/unit/components",
    "test:ai": "vitest run __tests__/unit/hooks __tests__/unit/components"
  }
}
```

### Vitest config addition

```typescript
// vitest.config.ts — add to `test` section
environmentMatch: {
  '__tests__/unit/hooks/': 'jsdom',
  '__tests__/unit/components/': 'jsdom',
},
```

### Automated regression check in CI

```
# Add to CI workflow after build:
bun test:hooks
bun test:components
```

### Test coverage expansion

If you want coverage on hooks/components, add to `vitest.config.ts`:
```typescript
coverage: {
  include: ['src/server/**/*.ts', 'src/hooks/**/*.ts', 'src/components/ai/**/*.tsx'],
}
```

---

## Appendix D: Known Bug Test Vectors

These are past bugs we MUST catch with the above tests:

| Bug | Fixture | Assertion |
|-----|---------|-----------|
| Markdown re-rendering | `markdown-streaming-stability` | completed assistant messages have `status: 'complete'`, only active streaming has `'streaming'` |
| Flashcard skeleton dead code | `intermediate-batch-readonly` | assistant message with `generate_flashcards` result has `result` field present with valid `readOnly` |
| `finish` with flashcards silently dropped | `finish-with-flashcards-consolidated` | final assistant message has `result.type === 'flashcards'` with `readOnly: false` and `deckName` |
| Plan instantly completed | `plan-step-tracking` | `completedSteps` array grows incrementally, not all at once before finish; `planCompleted` is false until `finish` tool call |
| Globally-applied `isStreaming` flag | `markdown-streaming-stability` | Previous assistant message's parts all `'complete'`, only new active stream parts `'streaming'` |
| Skill router DeepSeek json_object error | N/A (not a frontend issue) | N/A |
