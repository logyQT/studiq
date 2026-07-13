# PRD: Teacher Assignment Module (Kartkówka / Sprawdzian)

## Core Concept

A persistent quiz resource created **by teachers** — not ephemeral like the existing
student quiz system. Teachers curate questions (manually or via randomize), assign to
groups/students with deadlines, publish, grade open answers, and export PDFs for both
blank tests and archival book-keeping.

---

## Data Model

### New tables

| Table | Purpose |
|-------|---------|
| `teacher_assignments` | The assignment itself (title, deadline, time limit, status, settings) |
| `assignment_questions` | M:N linking assignment → questions with points + order |
| `assignment_targets` | M:N linking assignment → groups OR individual students |
| `assignment_answer_images` | Student photo uploads for open questions |

### Extended tables

| Table | Change |
|-------|--------|
| `quiz_attempts` | + `assignment_id` FK (links student submission to assignment) |

### New enum

```sql
CREATE TYPE assessment_status AS ENUM ('draft', 'published');
```

### New bucket

`assignment-images` in Supabase Storage
(path: `/{orgId}/{assignmentId}/{attemptId}/{questionId}/{file}`)

### Key column defaults on `teacher_assignments`

| Column | Default | Notes |
|--------|---------|-------|
| `status` | `'draft'` | Not public by default |
| `max_attempts` | `1` | Teacher can increase |
| `passing_score` | `null` | Optional percentage threshold |
| `show_results` | `false` | Teacher decides |
| `shuffle_questions` | `true` | |
| `shuffle_answers` | `true` | |

---

## Flows

### 1. Teacher creates

- Page at `/edu/assessments/new`
- Title, description, deadline, time limit, passing score, show results, max attempts
- **Question selection**: Browse banks → multi-select.
  **"Randomize" button**: pops a dialog with a count field + source picker
  (bank/topic/all) + type filter, picks N random.
- Auto-saves as `draft`, teacher can return later

### 2. Assign & publish

- Select target groups (checkboxes) or individual students
- Deadline (optional, already set or overridden here)
- Click "Publish" → status flips to `published`, students see it

### 3. Student takes

- `/app/assessments` shows pending assignments with deadlines
- Start → creates `quiz_attempts` with `assignment_id`
- MCQ/TrueFalse: existing quiz UI
- **Open questions**: textarea + "Upload photo" button (Supabase Storage)
- Submit → MCQ/TF auto-graded, open = 0 points (pending teacher grade)

### 4. Teacher grades

- `/edu/assessments/[id]/results` → table of students + scores
- Click student → per-student grading page
- **Per-question grading view** (vertical split):
  - Question content + correct answer at top
  - All students' answers listed below (text + uploaded images)
  - Teacher assigns points, adds feedback, auto-saves
- When `show_results` enabled, student sees grade after teacher completes grading

### 5. PDF - Blank test (print)

- `/edu/assessments/[id]/print` → new tab with print-optimized CSS
- Header: title, teacher, "Name: ___", "Class: ___", "Date: ___"
- MCQ: bubble circles, True/False: checkboxes, Open: ruled lines
- Settings: show/hide name/class/date/points/instructions, compact/spacious layout,
  answer key page
- Uses `window.print()` + `@media print` CSS — no dependency, teacher can
  "Save as PDF" from the browser dialog

### 6. PDF - Answer sheet archival (book-keeping)

- `/edu/assessments/[id]/export-answers` → choose **bulk** (all students) or
  **single** (one student, for edge cases like a new joiner)
- Renders a print-optimized page with all student answers + teacher grades/feedback
- Student name header per section, page breaks between students
- Teacher uses browser "Save as PDF" or `Ctrl+P`
- Complies with Polish 5-year retention requirement

---

## Routes

### Teacher (`/edu`)

| Route | Page |
|-------|------|
| `/edu/assessments` | List |
| `/edu/assessments/new` | Create |
| `/edu/assessments/[id]` | Detail (manage + assign + publish) |
| `/edu/assessments/[id]/edit` | Edit (draft only) |
| `/edu/assessments/[id]/results` | Results table |
| `/edu/assessments/[id]/results/[studentId]` | Per-student grading |
| `/edu/assessments/[id]/results/question/[qId]` | Per-question grading (vertical split) |
| `/edu/assessments/[id]/print` | Print blank test |
| `/edu/assessments/settings` | Teacher's PDF defaults |

### Student (`/app`)

| Route | Page |
|-------|------|
| `/app/assessments` | Pending + completed list |
| `/app/assessments/[id]` | Detail + start |
| `/app/assessments/[id]/take` | Take (quiz session UI + image upload) |
| `/app/assessments/[id]/review` | Results (if teacher allows) |

### API

Prefix: `/api/v1/teacher/assessments` (teacher), `/api/v1/assessments` (student).
Follow existing patterns (POST/GET/PUT/DELETE, controller → service → supabase).

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v1/teacher/assessments` | List |
| POST | `/api/v1/teacher/assessments` | Create |
| GET | `/api/v1/teacher/assessments/[id]` | Get detail |
| PUT | `/api/v1/teacher/assessments/[id]` | Update |
| DELETE | `/api/v1/teacher/assessments/[id]` | Delete |
| POST | `/api/v1/teacher/assessments/[id]/publish` | Publish |
| POST | `/api/v1/teacher/assessments/[id]/questions` | Add questions (batch) |
| DELETE | `/api/v1/teacher/assessments/[id]/questions/[qId]` | Remove question |
| POST | `/api/v1/teacher/assessments/[id]/randomize` | Randomize + add |
| PUT | `/api/v1/teacher/assessments/[id]/targets` | Set targets |
| GET | `/api/v1/teacher/assessments/[id]/results` | Results overview |
| GET | `/api/v1/teacher/assessments/[id]/results/[studentId]` | Student answers |
| PUT | `/api/v1/teacher/assessments/[id]/results/[studentId]/grade` | Grade open questions |
| GET | `/api/v1/teacher/assessments/[id]/export-answers` | Download archival PDF |
| GET | `/api/v1/assessments` | Student list |
| GET | `/api/v1/assessments/[id]` | Student detail |
| POST | `/api/v1/assessments/[id]/start` | Start attempt |
| POST | `/api/v1/quiz/[attemptId]` | Submit (existing) |
| POST | `/api/v1/assessments/[id]/upload-image` | Upload answer photo |

---

## Permissions

```typescript
ASSIGNMENT_CREATE: 'assignment.create',
ASSIGNMENT_READ: 'assignment.read',
ASSIGNMENT_UPDATE: 'assignment.update',
ASSIGNMENT_DELETE: 'assignment.delete',
ASSIGNMENT_PUBLISH: 'assignment.publish',
ASSIGNMENT_GRADE: 'assignment.grade',
```

| Role | Scope |
|------|-------|
| teacher | `own` |
| admin | `organization` |

Student access is determined by `assignment_targets` matching their user or group,
not by permissions.
