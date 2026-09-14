# Question Types — Expansion Specification

**Status:** Draft  
**Date:** 2026-06-19  
**Related:** `FLASHCARD_IMPROVEMENTS.md` (Section 3.2 — Cloze Deletion)

---

## 1. Current State

### 1.1 Database Schema

**`questions` table:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | PK |
| `university_id` | uuid | FK → universities (nullable) |
| `subject_id` | uuid | FK → subjects (nullable) |
| `created_by` | uuid | FK → profiles (teacher) |
| `type` | question_type | ENUM: `'mcq'`, `'true_false'`, `'open'` |
| `content` | text | Question text |
| `explanation` | text | Post-answer explanation (nullable) |
| `difficulty` | question_difficulty | ENUM: `'easy'`, `'medium'`, `'hard'` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**`question_answers` table:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | PK |
| `question_id` | uuid | FK → questions (CASCADE) |
| `content` | text | Answer text |
| `is_correct` | boolean | Whether this is the correct answer |
| `order_index` | int | Display ordering |

### 1.2 Current Question Types

| Type | Answers | Correct Answer | Grading |
|------|---------|----------------|---------|
| `mcq` | 2+ options, one radio-select | Single `is_correct` flag | Exact match on `selected_answer_id` |
| `true_false` | Exactly 2 (True, False) | Single `is_correct` flag | Exact match on `selected_answer_id` |
| `open` | No predefined answers | N/A (no answers stored) | Not auto-graded |

### 1.3 Current Grading Logic

In `quiz-attempt.service.ts:submit()`:
```typescript
// Only checks if selected_answer_id matches an is_correct answer
if (ans.selectedAnswerId) {
  const { data: answer } = await supabase
    .from('question_answers')
    .select('is_correct')
    .eq('id', ans.selectedAnswerId)
    .single();
  isCorrect = answer?.is_correct ?? false;
}
```

**Limitation:** Only supports single-answer selection via `selected_answer_id`. No support for:
- Multiple correct answers (checkbox)
- Text input answers (cloze, short answer)
- Matched pairs (matching)

---

## 2. Proposed Question Types

### 2.1 Type Summary

| Type | Label | Answers | Correct Answer | Grading | Status |
|------|-------|---------|----------------|---------|--------|
| `mcq` | Multiple Choice | 2+ options, single select | Single `is_correct` | Existing | Keep |
| `true_false` | True/False | 2 options | Single `is_correct` | Existing | Keep |
| `short_answer` | Short Answer | Text input | 1+ accepted answers | Exact match or LLM | **Rename from `open`** |
| `cloze` | Cloze (Fill-in-the-Blank) | Text input per gap | 1+ accepted answers per gap | Exact match | **New** |
| `checkbox` | Checkbox (Multi-Select) | 2+ options, multi select | Multiple `is_correct` flags | All correct selected, no incorrect | **New** |
| `matching` | Matching | Pairs of items | Correct pair mapping | All pairs correct | **New** |
| `image_choice` | Image Choice | 2+ image options, single select | Single `is_correct` | Exact match on `selected_answer_id` | **New** |

### 2.2 Type Definitions

#### `short_answer` (renamed from `open`)

**Purpose:** Student types a word or short sentence. Used for recall-based questions where the answer is a specific term, name, or phrase.

**Content format:** Plain text question.  
**Answer storage:** 1+ `question_answers` rows with `is_correct: true` for each accepted variant.  
**Grading:**
- **Phase 1:** Exact string match (case-insensitive, trimmed). Multiple accepted answers allow synonyms.
- **Phase 2 (future):** LLM-assisted grading — if the typed answer doesn't match any accepted answer, send to LLM with the question + correct answer for semantic similarity check. This is a soft grading pass that returns a confidence score; below threshold = incorrect.

**Example:**
```
Question: "What is the chemical symbol for gold?"
Accepted answers: ["Au", "au", "AU"]
```

#### `cloze`

**Purpose:** Fill-in-the-blank questions. The question contains gaps that the student must fill.

**Content format:** Text with `{{c1::answer}}` syntax for gaps.  
- `{{c1::gold}}` → Gap 1, correct answer is "gold"  
- `{{c2::silver}}` → Gap 2, correct answer is "silver"  
- Multiple correct answers per gap: `{{c1::Au|gold|Gold}}`

**Answer storage:** Each gap becomes a `question_answers` row:
- `content` = the gap text (e.g., "gold")  
- `is_correct` = `true`  
- `order_index` = gap number (0, 1, 2, ...)  
- Additional accepted variants stored in `accepted_values` JSONB column

**Grading:** Exact match per gap (case-insensitive, trimmed). All gaps must be correct.

**Example:**
```
Content: "The chemical symbol for {{c1::gold}} is {{c2::Au}}."
Gap 1 accepted: ["gold", "Gold", "GOLD"]
Gap 2 accepted: ["Au", "au"]
```

#### `checkbox`

**Purpose:** Multi-select questions where the student must select ALL correct answers (and no incorrect ones).

**Content format:** Plain text question.  
**Answer storage:** 2+ `question_answers` rows. Multiple rows have `is_correct: true`.  
**Grading:** Student submits array of `selected_answer_ids`. Correct if:
- All `is_correct: true` answers are selected
- No `is_correct: false` answers are selected

**Example:**
```
Question: "Which of the following are noble gases? (Select all that apply)"
Answers: [
  { content: "Helium", is_correct: true },
  { content: "Nitrogen", is_correct: false },
  { content: "Neon", is_correct: true },
  { content: "Oxygen", is_correct: false },
]
Correct submission: [Helium, Neon]
```

#### `matching`

**Purpose:** Match items from column A to column B.

**Content format:** Plain text question (e.g., "Match the elements with their symbols").  
**Answer storage:** Pairs stored as `question_answers` rows:
- `content` = left item text  
- `is_correct` = `true`  
- `match_value` = the right item this left item matches  

**Grading:** Student submits `{ leftId, rightId }` pairs. Correct if all pairs match the stored `match_value`.

**Example:**
```
Question: "Match the elements with their chemical symbols"
Pairs: [
  { content: "Gold", match_value: "Au", is_correct: true },
  { content: "Silver", match_value: "Ag", is_correct: true },
  { content: "Iron", match_value: "Fe", is_correct: true },
]
Right items (shuffled in UI): ["Fe", "Au", "Ag"]
```

#### `image_choice`

**Purpose:** Multiple choice where answer options are images instead of text.

**Content format:** Plain text question.  
**Answer storage:** 2+ `question_answers` rows:
- `content` = image URL or storage path  
- `is_correct` = `true` for the correct image  
- `order_index` = display order  

**Grading:** Same as `mcq` — single `selected_answer_id` match.

**Media storage:** Images uploaded to Supabase Storage bucket `question-media`, URLs stored in `question_answers.content`.

**Example:**
```
Question: "Which of these is a beaker?"
Answers: [
  { content: "https://storage.../beaker.jpg", is_correct: true },
  { content: "https://storage.../flask.jpg", is_correct: false },
  { content: "https://storage.../test_tube.jpg", is_correct: false },
]
```

---

## 3. Database Schema Changes

### 3.1 Enum Update

```sql
-- Migration: expand question_type enum
ALTER TYPE question_type ADD VALUE 'short_answer';
ALTER TYPE question_type ADD VALUE 'cloze';
ALTER TYPE question_type ADD VALUE 'checkbox';
ALTER TYPE question_type ADD VALUE 'matching';
ALTER TYPE question_type ADD VALUE 'image_choice';

-- PostgreSQL doesn't allow removing enum values.
-- Existing 'open' rows migrated to 'short_answer' via data migration.
```

**PostgreSQL enum limitation:** You cannot remove enum values.  
**Recommended:** Add all new values, migrate `open` → `short_answer` data, keep `open` in enum but filter it out in queries.

### 3.2 `question_answers` Table Changes

```sql
ALTER TABLE public.question_answers
  ADD COLUMN match_value text,           -- for matching questions
  ADD COLUMN media_url text,             -- for image_choice
  ADD COLUMN accepted_values jsonb;      -- for short_answer/cloze (additional accepted answers)
```

**Column purpose:**
- `match_value`: Stores the right-side item for matching questions. NULL for other types.
- `media_url`: Explicit image URL for image_choice.
- `accepted_values`: JSON array of additional accepted answers. E.g., `["Au", "au", "AU"]`. The primary `content` is always the canonical answer.

### 3.3 Updated Schema

```sql
CREATE TABLE public.question_answers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id      uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  content          text NOT NULL,
  is_correct       boolean NOT NULL DEFAULT false,
  order_index      int NOT NULL DEFAULT 0,
  match_value      text,
  media_url        text,
  accepted_values  jsonb
);
```

### 3.4 Migration Plan

```sql
-- 1. Add new enum values
ALTER TYPE question_type ADD VALUE 'short_answer';
ALTER TYPE question_type ADD VALUE 'cloze';
ALTER TYPE question_type ADD VALUE 'checkbox';
ALTER TYPE question_type ADD VALUE 'matching';
ALTER TYPE question_type ADD VALUE 'image_choice';

-- 2. Migrate existing 'open' questions to 'short_answer'
UPDATE public.questions SET type = 'short_answer' WHERE type = 'open';

-- 3. Add new columns to question_answers
ALTER TABLE public.question_answers
  ADD COLUMN match_value text,
  ADD COLUMN media_url text,
  ADD COLUMN accepted_values jsonb;
```

---

## 4. Backend Changes

### 4.1 Model Layer (`question.model.ts`)

**Updated `QuestionTypeEnum`:**
```typescript
export const QuestionTypeEnum = z.enum([
  'mcq', 'true_false', 'short_answer', 'cloze', 'checkbox', 'matching', 'image_choice'
]);
```

**Updated `CreateQuestionSchema`:**
```typescript
export const CreateQuestionSchema = z.object({
  subjectId: z.uuid().optional(),
  type: QuestionTypeEnum,
  content: z.string().min(1).max(500),  // Increased for cloze syntax
  explanation: z.string().max(500).optional(),
  difficulty: DifficultyEnum.default('medium'),
  answers: z.array(z.object({
    content: z.string().min(1).max(255),
    isCorrect: z.boolean(),
    orderIndex: z.number().int().default(0),
    matchValue: z.string().optional(),
    mediaUrl: z.string().url().optional(),
    acceptedValues: z.array(z.string()).optional(),
  })).min(1),
});
```

**New validation per type:**
```typescript
const typeSchemas = {
  mcq: z.object({ answers: z.array(...).min(2) }),
  true_false: z.object({ answers: z.array(...).length(2) }),
  short_answer: z.object({ answers: z.array(...).min(1) }),
  cloze: z.object({ answers: z.array(...).min(1) }),
  checkbox: z.object({ answers: z.array(...).min(2) }),
  matching: z.object({ answers: z.array(...).min(2) }),
  image_choice: z.object({ answers: z.array(...).min(2) }),
};
```

### 4.2 Quiz Attempt Model (`quiz-attempt.model.ts`)

**Current submission:** `{ questionId, selectedAnswerId }` — only supports single selection.

**Updated submission:**
```typescript
export const SubmitQuizAttemptSchema = z.object({
  attemptId: z.uuid(),
  answers: z.array(z.object({
    questionId: z.uuid(),
    // For mcq, true_false, image_choice:
    selectedAnswerId: z.uuid().optional(),
    // For checkbox:
    selectedAnswerIds: z.array(z.uuid()).optional(),
    // For cloze, short_answer:
    textAnswers: z.array(z.object({
      gapIndex: z.number().int(),
      value: z.string(),
    })).optional(),
    // For matching:
    matchedPairs: z.array(z.object({
      leftId: z.uuid(),
      rightId: z.uuid(),
    })).optional(),
  })),
});
```

### 4.3 Service Layer Changes

**`quiz-attempt.service.ts:submit()` — Grading Logic:**

```typescript
for (const ans of data.answers) {
  const question = questionMap.get(ans.questionId);
  
  switch (question.type) {
    case 'mcq':
    case 'true_false':
    case 'image_choice':
      isCorrect = await gradeSingleSelect(ans.selectedAnswerId);
      break;
    case 'checkbox':
      isCorrect = await gradeCheckbox(ans.selectedAnswerIds, question.id);
      break;
    case 'short_answer':
      isCorrect = await gradeShortAnswer(ans.textAnswers, question.id);
      break;
    case 'cloze':
      isCorrect = await gradeCloze(ans.textAnswers, question.id);
      break;
    case 'matching':
      isCorrect = await gradeMatching(ans.matchedPairs, question.id);
      break;
  }
}
```

**Grading functions:**
```typescript
async function gradeCheckbox(selectedIds: string[], questionId: string): Promise<boolean> {
  const { data: answers } = await supabase
    .from('question_answers')
    .select('id, is_correct')
    .eq('question_id', questionId);
  
  const correctIds = new Set(answers.filter(a => a.is_correct).map(a => a.id));
  const selectedSet = new Set(selectedIds);
  
  return correctIds.size === selectedSet.size &&
         [...correctIds].every(id => selectedSet.has(id));
}

async function gradeShortAnswer(textAnswers: TextAnswer[], questionId: string): Promise<boolean> {
  const { data: answers } = await supabase
    .from('question_answers')
    .select('content, accepted_values')
    .eq('question_id', questionId)
    .eq('is_correct', true);
  
  const typed = textAnswers[0]?.value?.trim().toLowerCase() ?? '';
  
  if (answers.some(a => a.content.trim().toLowerCase() === typed)) return true;
  
  return answers.some(a => {
    const accepted = (a.accepted_values as string[]) ?? [];
    return accepted.some(v => v.trim().toLowerCase() === typed);
  });
}

async function gradeCloze(textAnswers: TextAnswer[], questionId: string): Promise<boolean> {
  const { data: answers } = await supabase
    .from('question_answers')
    .select('content, order_index, accepted_values')
    .eq('question_id', questionId)
    .eq('is_correct', true)
    .order('order_index');
  
  return textAnswers.every(ta => {
    const answer = answers.find(a => a.order_index === ta.gapIndex);
    if (!answer) return false;
    
    const typed = ta.value.trim().toLowerCase();
    const primary = answer.content.trim().toLowerCase();
    const accepted = ((answer.accepted_values as string[]) ?? []).map(v => v.trim().toLowerCase());
    
    return typed === primary || accepted.includes(typed);
  });
}

async function gradeMatching(matchedPairs: MatchedPair[], questionId: string): Promise<boolean> {
  const { data: answers } = await supabase
    .from('question_answers')
    .select('id, match_value')
    .eq('question_id', questionId);
  
  const correctMap = new Map(answers.map(a => [a.id, a.match_value]));
  
  return matchedPairs.every(pair => {
    const expectedRight = correctMap.get(pair.leftId);
    return expectedRight && expectedRight === correctMap.get(pair.rightId);
  });
}
```

### 4.4 Question Service — Cloze Parser

```typescript
function parseClozeContent(content: string): { text: string; gaps: ClozeGap[] } {
  const gapRegex = /\{\{c(\d+)::([^}]+)\}\}/g;
  const gaps: ClozeGap[] = [];
  let match;
  
  while ((match = gapRegex.exec(content)) !== null) {
    const index = parseInt(match[1]) - 1;
    const parts = match[2].split('|');
    gaps.push({
      index,
      canonical: parts[0],
      acceptedValues: parts.slice(1),
    });
  }
  
  const text = content.replace(/\{\{c\d+::[^}]+\}\}/g, '______');
  return { text, gaps };
}
```

---

## 5. Frontend Changes

### 5.1 Question Creation Form

| Type | Form UI |
|------|---------|
| `mcq` | Text input + dynamic answer list (radio buttons, add/remove) |
| `true_false` | Auto-generated True/False answers |
| `short_answer` | Text input + accepted answers list (comma-separated or multi-input) |
| `cloze` | Text input with `{{c1::answer}}` syntax helper + preview |
| `checkbox` | Text input + dynamic answer list (checkboxes, add/remove) |
| `matching` | Left/right item pairs (two-column layout) |
| `image_choice` | Text input + image upload for each answer option |

### 5.2 Quiz Taking Interface

| Type | Widget |
|------|--------|
| `mcq` | Radio button group |
| `true_false` | Two radio buttons (True/False) |
| `short_answer` | Single text input |
| `cloze` | Multiple text inputs (one per gap) embedded in question text |
| `checkbox` | Checkbox group |
| `matching` | Drag-and-drop or dropdown pairing |
| `image_choice` | Image grid with click-to-select |

### 5.3 Quiz Results Display

- `mcq`/`true_false`/`image_choice`: Highlight selected vs correct
- `checkbox`: Show which were correct/incorrect, which were missed
- `short_answer`/`cloze`: Show typed answer vs correct answer
- `matching`: Show correct pairs vs selected pairs

### 5.4 i18n Keys

New keys for `en.json` and `pl.json`:
```json
{
  "short_answer": "Short Answer",
  "cloze": "Cloze",
  "checkbox": "Checkbox",
  "matching": "Matching",
  "image_choice": "Image Choice",
  "cloze_syntax_hint": "Use {{c1::answer}} to create gaps",
  "match_left_item": "Left item",
  "match_right_item": "Right item",
  "select_all_that_apply": "Select all that apply",
  "type_your_answer": "Type your answer",
  "gap": "Gap {{index}}"
}
```

---

## 6. Short Answer + LLM Grading (Future Enhancement — Not Implemented Now)

### 6.1 Overview

For `short_answer` questions, exact string matching is often too rigid. A student might write "the symbol is Au" instead of just "Au". LLM-assisted grading provides semantic flexibility.

### 6.2 Grading Pipeline

```
Student answer
    |
    v
[Exact match check] --- Match? ---> Correct (score: 1.0)
    |
    No match
    |
    v
[LLM semantic check] --> Confidence score (0.0 - 1.0)
    |
    +-- Score >= 0.8 --> Correct (score: 1.0)
    +-- Score >= 0.5 --> Partial (score: 0.5) [optional]
    +-- Score < 0.5  --> Incorrect (score: 0.0)
```

### 6.3 LLM Prompt Template

```
You are a grading assistant. Evaluate if the student's answer is semantically 
equivalent to the correct answer.

Question: {question_content}
Correct answer: {correct_answer}
Student answer: {student_answer}

Respond with a JSON object:
{ "confidence": 0.0-1.0, "reasoning": "brief explanation" }
```

### 6.4 Implementation Notes

- **Not implemented in this phase** — future enhancement
- Requires LLM API integration (OpenAI, Anthropic, etc.)
- Cost consideration: LLM calls per answer during quiz submission
- Caching: Hash of (question + student_answer) → score to avoid repeat calls
- Fallback: If LLM unavailable, fall back to exact match
- Store LLM grading results in `quiz_answer_llm_grading` table for audit

---

## 7. Question Collection — Flashcard to Question Conversion

### 7.1 Concept

Transform existing flashcard collections into question banks. A flashcard's `front` becomes a question prompt, and the `back` becomes the correct answer. Other flashcards' `back` values serve as distractors.

This can be modeled as a new tool/service: **Question Collection Generator**. It works within the same topic or deck context as flashcards.

### 7.2 Conversion Strategies

#### Strategy 1: Flashcard → MCQ

**Input:** A deck/topic of flashcards  
**Process:**
1. Select a flashcard as the "target" (front → question, back → correct answer)
2. Randomly select 3 other flashcards' `back` values as distractors
3. Create an `mcq` question with 4 options (1 correct + 3 distractors)

**Constraint:** Requires at least 4 flashcards in the source. Works best for text-only cards.

**Example:**
```
Flashcard 1: front="Capital of France?" back="Paris"
Flashcard 2: front="Capital of Germany?" back="Berlin"
Flashcard 3: front="Capital of Spain?" back="Madrid"
Flashcard 4: front="Capital of Italy?" back="Rome"

Generated MCQ:
  Question: "Capital of France?"
  Options: ["Paris", "Berlin", "Madrid", "Rome"]
  Correct: "Paris"
```

#### Strategy 2: Flashcard → Short Answer

**Input:** A flashcard  
**Process:**
1. Use `front` as question content
2. Use `back` as the single accepted answer
3. Optionally use other flashcards' `back` values as additional accepted answers (synonyms)

#### Strategy 3: Flashcard → Cloze

**Input:** A flashcard where `front` contains a statement with a key term  
**Process:**
1. Teacher manually marks the gap position using cloze syntax
2. Or (future): LLM identifies the key term and creates a cloze automatically

**Example:**
```
Flashcard: front="Paris is the capital of France" back="Paris"
Generated cloze: "______ is the capital of France" (gap: "Paris")
```

#### Strategy 4: Flashcard → Matching

**Input:** A topic/deck of flashcards  
**Process:**
1. Select 4+ flashcards
2. Left items = flashcard `front` values
3. Right items = flashcard `back` values (shuffled)

**Example:**
```
Flashcards:
  "Capital of France" → "Paris"
  "Capital of Germany" → "Berlin"
  "Capital of Spain" → "Madrid"

Generated matching:
  Left: ["Capital of France", "Capital of Germany", "Capital of Spain"]
  Right (shuffled): ["Madrid", "Paris", "Berlin"]
```

### 7.3 API Endpoint

```
POST /api/v1/questions/generate-from-flashcards
Body: {
  source: 'deck' | 'topic',
  sourceId: string,
  types: ('mcq' | 'short_answer' | 'cloze' | 'matching')[],
  count: number,
  subjectId?: string,
}
Response: {
  questions: Question[],
  warnings: string[],
}
```

### 7.4 Constraints

- **Text-only limitation:** Only works for flashcards where `front` and `back` are plain text or simple markdown. Cards with images, audio, or complex formatting should be excluded.
- **Minimum pool size:** MCQ needs >= 4 cards, matching needs >= 3 cards.
- **Distractor quality:** Random distractors from the same topic work well; random from all decks may produce nonsensical options.
- **Teacher review:** Generated questions should be presented as drafts for teacher review before being added to the question bank.

### 7.5 Future Enhancement

- **LLM-powered distractor selection:** Instead of random distractors, use LLM to select semantically plausible wrong answers
- **LLM-powered cloze generation:** LLM identifies key terms in flashcard content and creates cloze deletions automatically
- **Batch generation:** Generate questions from an entire deck/topic in one operation
- **Question quality scoring:** LLM evaluates generated questions for clarity, difficulty, and distractor plausibility

---

## 8. Implementation Phases

### Phase 1: Rename `open` → `short_answer` (Low effort, high value)

**Files:**
- Migration: Add `short_answer` to enum, migrate data
- Model: Update `QuestionTypeEnum`
- Service: No logic change (same as `open`)
- Frontend: Update labels, add accepted answers input

**Effort:** ~1 day

### Phase 2: Checkbox Questions (Medium effort)

**Files:**
- Model: Add validation for checkbox type
- Service: Implement `gradeCheckbox()` in quiz-attempt service
- Frontend: Checkbox answer widget, multi-select submission

**Effort:** ~1-2 days

### Phase 3: Cloze Questions (Medium effort)

**Files:**
- Migration: Add `accepted_values` column
- Model: Add cloze content validation
- Service: Implement `gradeCloze()`, cloze parser
- Frontend: Cloze syntax helper, gap input widgets

**Effort:** ~2-3 days

### Phase 4: Matching Questions (Higher effort)

**Files:**
- Migration: Add `match_value` column
- Model: Add matching pair validation
- Service: Implement `gradeMatching()`
- Frontend: Drag-and-drop or dropdown pairing widget

**Effort:** ~2-3 days

### Phase 5: Image Choice Questions (Medium effort)

**Files:**
- Migration: Add `media_url` column (or use existing `content`)
- Storage: Supabase Storage bucket for question media
- Frontend: Image upload, image grid selection widget

**Effort:** ~2 days

### Phase 6: Flashcard → Question Generator (Higher effort)

**Files:**
- New service: `question-generation.service.ts`
- New route: `POST /api/v1/questions/generate-from-flashcards`
- Frontend: Generation dialog in teacher question management

**Effort:** ~3-4 days

### Phase 7: LLM Grading for Short Answer (Future)

**Files:**
- New service: `llm-grading.service.ts`
- LLM API integration
- Grading pipeline in quiz-attempt service

**Effort:** ~3-5 days

---

## 9. Migration Strategy

### Backward Compatibility

- Existing `mcq` and `true_false` questions continue to work unchanged
- Existing `open` questions are migrated to `short_answer` with the same behavior
- Quiz generation API accepts both old and new type names during transition
- Frontend filters out deprecated `open` type from dropdowns

### Data Migration

```sql
BEGIN;
  ALTER TYPE question_type ADD VALUE 'short_answer';
  ALTER TYPE question_type ADD VALUE 'cloze';
  ALTER TYPE question_type ADD VALUE 'checkbox';
  ALTER TYPE question_type ADD VALUE 'matching';
  ALTER TYPE question_type ADD VALUE 'image_choice';
  
  UPDATE public.questions SET type = 'short_answer' WHERE type = 'open';
COMMIT;
```

### Rollback Plan

- New enum values can be left in place (PostgreSQL doesn't support removing them)
- New columns can be dropped if needed
- Data migration is one-way (`open` → `short_answer`)

---

## 10. Open Questions

1. **Cloze syntax:** Should we use `{{c1::answer}}` (Anki-style) or a simpler `{answer}` syntax? Anki-style is more powerful (multiple gaps, ordering) but harder to type.

2. **Matching UI:** Drag-and-drop vs dropdown pairing? Drag-and-drop is more intuitive but harder to implement (needs a DnD library). Dropdowns are simpler but less engaging.

3. **Image choice storage:** Should images be stored in the same `question_answers.content` field (as URLs) or in a dedicated `media_url` column?

4. **Short answer LLM grading:** Should this be a separate feature flag or always-on? Cost implications?

5. **Question generation from flashcards:** Should generated questions be drafts (require teacher approval) or auto-published?

6. **Cloze + short_answer overlap:** Are these distinct enough? Cloze is specifically "fill in the blank in context" while short_answer is "answer this question from memory". The UX is different even if grading is similar.
