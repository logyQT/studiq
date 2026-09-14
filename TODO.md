# TODO — Quiz Feature Gaps

## Integration Tests

- [ ] **Teacher quizzes API** (`/api/v1/teacher/quizzes/*`) — full Route → Controller → Service → DB tests for all 8 endpoints (list, create, get, update, delete, bulk, questions, reorder, create-assignment)
- [ ] **Unpublish assignment** (`/api/v1/teacher/assignments/[id]/unpublish`) — add to existing teacher-assignment integration suite
- [ ] **Quiz attempt submission with new question types** — verify `multi_select`, `matching`, `ordering`, `fill_in_blank` scoring works end-to-end

## Schema & Migration Tests

- [ ] **Migration `20260715000001_create_quizzes.sql`** — verify it runs cleanly on a fresh DB, creates all expected tables/indexes
- [ ] **Migration `20260716000001_new_question_types.sql`** — verify enum扩展 (`multi_select`, `matching`, `ordering`, `fill_in_blank`) applies without error
- [ ] **`question_answers` → `question_options` rename** — verify the migration handles the rename + new columns (`match_group`, `match_side`) correctly
- [ ] **`quiz_answers` → `student_answers` rename** — verify migration applies and old data is preserved

## Unit Test Gaps

- [ ] **`QuizTeacherService.reorderQuestions` DB error mid-loop** — test that partial updates don't corrupt state when the 2nd+ update fails
- [ ] **`QuizTeacherService.bulkSave` delete error** — currently only update and insert errors are tested; delete step (step 3) has no error test
- [ ] **`QuizTeacherService.bulkSave` re-fetch error** — test the final select step failure
- [ ] **`QuizTeacherService.bulkSave` update with `description: null`** — verify `description ?? null` behaves correctly when description is omitted
- [ ] **Model schema validation** — negative tests for `BulkSaveQuizSchema` (e.g. negative `points`, negative `order_index`, invalid UUID in `question_id`)

## Frontend

- [ ] **Quiz editor drag-and-drop** — no unit tests for `edit-client.tsx` reorder logic
- [ ] **Quiz list/detail/new pages** — no component tests for any `edu/quizzes/*` pages
- [ ] **Question browser** (`question-browser.tsx`) — no tests for search/filter/selection logic

## Error Handling

- [ ] **`toDbFailure` coverage** — verify all PG error codes used by quiz services map correctly (e.g. `23505` → `CONFLICT`, `PGRST116` → `NOT_FOUND`)
- [ ] **Concurrent `bulkSave`** — what happens if two teachers save the same quiz simultaneously? Race condition on delete-then-insert

## Seed Data

- [ ] **Quiz seed data** — `01_seed.sql` adds quiz data but no quiz_attempts or student_answers; add seed rows for E2E testing
- [ ] **New question type seeds** — add sample `multi_select`, `matching`, `ordering`, `fill_in_blank` questions to seed data

## i18n

- [ ] **Verify all new quiz keys** exist in both `en.json` and `pl.json` — check for missing translations
