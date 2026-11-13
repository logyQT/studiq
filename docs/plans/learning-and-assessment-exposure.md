# Learning and assessment: the exposure model

**Status:** draft v3 — corrected after three spec reviews and one doc review (fact-checks against
`main`, phase slicing, contract determinism). No implementation yet.
**Related:** #678 (closed — its framing is superseded by this model), #1165 (the concrete database
leak, phase 1), epic #1169.

## The problem

Question banks serve two activities with contradictory requirements:

- **Learning** needs feedback: the correct answer, an explanation, and unlimited retries.
- **Assessment** needs secrecy: no way to learn the answer before the grade is final.

Today one pool serves both. That was harmless while everything was self-practice; it became a
correctness problem the moment graded assessments were built on the same items:

- the answer key is reachable before and during an assessment (bank browsing, practice review,
  keyed CSV export, direct data access);
- practice reveals the key, and (when `show_results` is on) the assignment detail page offers
  "start another attempt" over the same fixed set while the review that precedes it already showed
  the key;
- a classmate learns the key from their own review and passes it on;
- an item reused next term is already known to the previous cohort.

Two findings forced this rewrite:

1. Hiding the flag in the API does not close the leak: the database's row policy grants `is_correct`
   to any authenticated reader of a question, so a client can bypass the API entirely.
2. A "self-quiz" without feedback is not practice — it is a confusion mechanism. You cannot solve
   this by letting students practise assessment items with the answers hidden.

## Why not "learning banks" and "test banks"

A type on the bank looks clean and is the wrong primitive:

- **It is not enforced anywhere.** A "test bank" is still a bank: browsable, exportable, and its key
  readable by anyone who can read the questions. The label expresses intent, not a boundary.
- **It forces a copy.** A question taught in September and assessed in October cannot live in one
  typed bank; the copy diverges the first time someone fixes a typo.
- **It cannot express "open to 8A, sealed for 8B"**, and forcing it org-wide blocks learning for
  hundreds of students because one class has a test.
- **It grades unlearned material.** If the test pool is never practised, students are assessed on
  items nobody ever taught.

Banks stay what they are: curation and sharing containers. The boundary lives in **items and time**,
not in shelves. Bank names such as "8A — learning" remain a convenience, never a rule.

## Decisions (operator)

| #   | Decision          | Choice                                                                                                   |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| a   | Reservation scope | **Per class**; org-wide only as an explicit per-assessment toggle, behind a blocking warning             |
| b   | Reveal moment     | **At close**, cohort-wide — not per submission                                                           |
| c   | Who may reserve   | **Any reader of the bank may include items**; owner notified, managers may override                      |
| d   | Retakes           | **Fresh sample** from items unseen by that student; same-item retake only as an explicit, flagged choice |
| e   | Close-out default | **Release to open**; retirement is an explicit option after repeated binding                             |
| f   | Explanation       | **Required for choice items**, cap **2 040 characters** (8 × today's 255), mechanical authoring checks   |
| g   | Ledger            | **Record from day one** — from phase 2, when the review first renders a key; phase 3 adds eligibility    |

## Review-driven amendments (v2)

1. **Reservation starts at window open, not at publish.** Scheduling a test three weeks out must not
   remove those items from practice for three weeks; otherwise the assessment grades material the
   student was forbidden to study. Publish forecasts the reservation; the window open activates it.
2. **Eligibility is computed per student at attempt start**, not per class at publish. A student who
   practised an item before the window opened is excluded from _their_ sample even if the class
   sample included it.
3. **Grading a pre-exposed item requires an explicit declaration.** Accidental exposure is excluded
   from that student's sample by default; including it requires `taughtItem`, which is labelled and
   excluded from fairness statistics.
4. **Reveal at close is unconditional and has no attempt condition.** Attempts exist only inside the
   window (amendment 6), so at `closesAt` nothing can leak through a retake: a fresh-sample retake is
   disjoint by construction, and a same-item retake must also have been taken before close. There is
   therefore no "review withheld because an attempt remains" state — an unused allowance expires at
   close. Item-level withholding (R10) stays a deliberate teacher action, not an attempt gate.
5. **An assessment has one window.** "Per class" scopes _who is sealed_, not when they finish. A
   single `opensAt`/`closesAt` removes the multi-class reveal ambiguity and the "8A is revealed while
   8B is still live" leak.
6. **Attempts exist only inside the window.** Close ends attempts; an in-progress attempt at close
   expires, counts as consumed, and cannot be submitted. A makeup is a new assessment, not a reopened
   window.
7. **`taughtItem` never unreserves.** Every item in an assessment is sealed for the window regardless
   of flags; the flag only waives the pre-exposure penalty.
8. **`withholdFromReview` keeps the item reserved past close** until the teacher explicitly releases
   it — otherwise the key is public the moment reservations end and withholding is theatre.
9. **Open-text items need a model answer**, not an explanation of a key: graded manually or excluded
   from the score in the MVP; the model answer is what review reveals.
10. **The MVP must expose the contracts**, not only screens: the page talks to an in-memory API, so
    the rules are testable without a database.

## Doc-review corrections (v3)

1. **Phase slicing now matches the issues.** Durable close, publish-once and withheld-item sealing
   move into phase 2 because close-time reveal depends on them; phase 5 keeps cancel, in-window
   attempt rules, fresh-sample retakes and per-attempt review.
2. **The ledger is defined by what the student sees, not by a screen we have not built.** Today the
   only key render is the post-submission review (practice quizzes are generated and deliver feedback
   in that review), so phase 2 writes exposure events there; a future study/practice surface writes
   the same event. Phase 3 adds eligibility, `taughtItem` and fairness reporting.
3. **`ungraded` is expressible**: `score: {earned, possible} | null`, per-item `correct: boolean |
null` with `graded: boolean`, and an explicit `ungradedCount`. `correct: boolean` alone could not
   carry the tri-state.
4. **Existing assignment controls are acknowledged**: `show_results` remains the per-assessment opt-in
   that decides whether a review exists at all; R5 decides _when_ it becomes readable, not whether the
   teacher enabled it. Existing window columns are reused.
5. **"Class" maps to the org group(s) an assessment targets.** A student may belong to several groups;
   an item is sealed for a student if any targeted group contains them, and the cohort is the union.
6. **Every refusal has a code** and every contract has an endpoint (export, extend, live edit, manager
   override, practice request/response), including `ATTEMPT_EXPIRED`, `ALREADY_SUBMITTED`,
   `NO_ATTEMPTS_LEFT`, `ASSESSMENT_ALREADY_PUBLISHED`, `ASSESSMENT_CANCELLED`.
7. **Aggregates are counts only** (right/wrong/ungraded per item, n ≥ 5) — never option-level, because
   an option distribution is the key.
8. **Non-goals corrected**: production database/RLS work is the MVP/demo's non-goal, not the project's;
   phase 1 is the production boundary.
9. **Permission**: staff key access reuses `question_bank.update` until a dedicated
   `question.answers.read` exists (phase 1 may introduce it); no undocumented permission is assumed.
10. **`taughtItem` waives both** the ledger event _and_ a prior answer when computing eligibility; it
    never unseals an item during the window.

## Goals

- Students learn from open questions with immediate feedback, explanations and retries.
- Students are graded on questions they could not pre-learn; that is a property of the system, not
  of teacher discipline.
- After an assessment, students still learn from it without arming a retake or the next class.
- Teachers author each question once and keep one source of truth.
- Every rule is enforceable server-side, with one sentence a teacher and a student both understand.

## Non-goals

- Generated twins / psychometric item variants, proctoring, plagiarism detection.
- Cross-institution transfer.
- Production database/RLS work **in the demo/MVP**: the demo stays in memory; phase 1 is the real
  database boundary and is not optional.

## Personas

| Actor                                  | Can                                                                                           | Cannot                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Teacher** (bank owner)               | author items, see keys/explanations, reserve, compose, grade, review                          | rely on discipline instead of enforcement                                                                                                   |
| **Colleague** (can read a shared bank) | include its items in an assessment they own (reserves them, owner notified)                   | edit the bank; see keys without the staff key permission                                                                                    |
| **Manager**                            | override reservations, see fairness reports, resolve disputes, author makeups                 | unreserve a live class, un-reveal                                                                                                           |
| **Student**                            | practise open items, take assigned assessments, see their own score, read reviews after close | read a key for a sealed item, read classmates' answers, retake unless the teacher allowed it, retake the same set unless explicitly enabled |

**Class** is the isolation unit for reservation and reveal. An assessment targets **groups and/or
individual students** (the existing assignment targets already allow both): a group target seals the
item for its members, and a student target seals it for that student only (a singleton class). A
student in several targeted groups is sealed once. **Cohort** = the union of targeted students and
members of targeted groups; a **makeup** is a separate assessment.

## Domain model

| Entity            | Fields (conceptual)                                                                                                                                                 | Notes                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Bank`            | id, org, owner, name, readers                                                                                                                                       | curation only; **no type**                                                                |
| `Item`            | id, bank, stem, type (`mcq`/`true_false`/`open`), options, correct option, explanation, modelAnswer, version, status (`open`/`retired`/`deleted`)                   | edits after binding create a new version                                                  |
| `Assessment`      | id, org, owner, groups[], studentIds[], `opensAt`, `closesAt`, state (`draft`/`scheduled`/`live`/`closed`/`cancelled`), scoring rules, `maxAttempts`, `showResults` | **one window**; publish-once applies from `live`                                          |
| `AssessmentItem`  | assessment, item, version, flags (`taughtItem`, `withholdFromReview`)                                                                                               | immutable once published                                                                  |
| `Reservation`     | item, assessment, groups[], studentIds[], effective window                                                                                                          | **derived**: active from `opensAt` to `closesAt` (or explicit release for withheld items) |
| `Attempt`         | assessment, student, state (`in_progress`/`submitted`/`expired`), started/finished, score, answers                                                                  | one in progress at a time; attempts only in-window                                        |
| `Answer`          | attempt, item, submitted value, correctness (`correct`/`incorrect`/`ungraded`)                                                                                      | never exposed before reveal                                                               |
| `ExposureEvent`   | student, item, group(s), `seenCorrect: true`, timestamp                                                                                                             | the **exposure ledger**; written when a key/explanation renders (idempotent)              |
| `PracticeAttempt` | student, bank/item set, answers, score                                                                                                                              | unlimited, no stakes                                                                      |

### Derived visibility

```text
// per student, per item
sealed(item, student) := exists active Reservation r where
    r.item = item
    and (student.id ∈ r.students or student.groups ∩ r.groups ≠ ∅)
    and now ∈ [r.opensAt, r.closesAt)          // or r held open by withholdFromReview

eligible(item, student) := not sealed(item, student)
    and not taughtItem(item, assessment)
    and no ExposureEvent(item, student)       // any key/explanation shown
    and no Answer(item, student)              // the student has never been shown it in an attempt

// per assessment, per student
canStartAttempt := now ∈ [opensAt, closesAt)
    and attemptsUsed < maxAttempts
    and no attempt in_progress
    and eligibleInventory(student) is not empty

// attempts exist only inside the window, so close leaves nothing outstanding
reviewUnlocked(student) := now >= closesAt
```

`retired` and `deleted` are authoring states, not time states: retired blocks new binding, deleted
hides the item from authoring and practice; a published assessment keeps its frozen version of either.

## Rules

**R1 — Banks never gate answers.** Only item reservation and the staff key permission do
(`question_bank.update` today; a dedicated `question.answers.read` may replace it in phase 1). Every
student read path filters sealed items and strips `correct`/`explanation`.

**R2 — Reservation is per class and active only inside the assessment window.** Reservations are
created at publish as a _forecast_ and become effective at `opensAt`; they end at `closesAt` (with
R10's withheld exception). _Test:_ 8A's test seals 20 items for 8A from open to close; 8B practises
them freely before and during 8A's window.

**R3 — Cross-class exposure is a blocking acknowledgement, not a dismissible warning.** On publish the
composer lists items still open to other classes and requires an explicit acknowledgement; each
assessment offers **"seal for the whole org"** (then every targeted group _and_ every targeted
student is sealed). The
default stays per class per decision (a). _Test:_ publish without acknowledgement is rejected; with
it, reservations target the assessment's classes; with org-wide, all classes.

**R4 — No key reaches a student for a sealed item on any path** — browsing, practice, exports, debug
payloads, or direct data reads (the last is a database-boundary rule in production). _Test:_ the
student payload contains no `correct`/`explanation` field at all (absent, not null).

**R5 — Answers reveal at close, cohort-wide, for everyone.** Immediately after submit a student sees
`score: {earned, possible} | null`, `ungradedCount`, and per item `correct: boolean | null` with
`graded: boolean` (never the key). At `closesAt`, review unlocks for every student in the cohort — an
unused attempt allowance simply expires (attempts cannot exist after close, R7). `show_results`
remains the assessment's opt-in: when it is off, no review is produced at any time; R5 governs when an
enabled review becomes readable, not whether it exists. _Test:_ review endpoint `403 REVIEW_LOCKED`
before close; 200 for a student who used one of three attempts, and for one who used none; 404/`OFF`
when `show_results` is false.

**R6 — Same-item retakes are an in-window choice, not a review gate.** `allowSameItemRetake` lets a
student retake the same set up to `maxAttempts` _before_ close; it never withholds review afterwards.
Fresh-sample retakes are the default. _Test:_ both retake modes finish inside the window and review
unlocks at close with no special case.

**R7 — Retakes happen inside the window and draw a fresh sample.** Up to `maxAttempts`; an
in-progress attempt at close expires, counts as consumed, and cannot be submitted. After close no new
attempt is possible; a makeup is a new assessment over items with no exposure event for that student.
_Test:_ retake after close → `409 ATTEMPTS_CLOSED`; retake sample disjoint from prior attempts.

**R8 — Any key render burns the item for that learner.** An exposure event is written whenever the
system shows a student a key or explanation — today that is the post-submission review (practice
quizzes deliver their feedback through it); a future study/practice surface writes the same event.
One event per (item, student). An item with an event is excluded from that student's graded sample
unless the teacher marks it `taughtItem`. _Test:_ open a reviewed item → publish warning count → the
student's sample omits it; a second render does not duplicate the event.

**R9 — Deliberate pre-exposure is declared, not forbidden.** `taughtItem` grades a taught item: it
scores, is labelled in results, and is excluded from fairness reporting. It waives **both** the
ledger event and a prior answer when computing eligibility, and it does **not** unseal the item
during the window (R2/R4 still apply). _Test:_ `taughtItem` is eligible despite a ledger event or a
prior submitted answer; the key is still hidden while live.

**R10 — `withholdFromReview` keeps an item sealed after close** until the teacher (or a manager)
explicitly releases it; item-level withholding outranks the automatic release at `closesAt`, and it
keeps the item sealed for the targeted classes, not just hidden in the review payload. _Test:_ after
close the withheld item is absent from review and still sealed for that class; `POST
/assessments/:id/items/:itemId/release` makes it visible and practiceable again.

**R11 — Items are frozen at publish.** Editing an item after publish creates a new version; the
assessment serves the published version. _Test:_ edit bound item → live assessment unchanged; new
practice sees the new version.

**R12 — An assessment has exactly one window and one class set.** A **scheduled** (not yet live)
assessment can be withdrawn back to draft — no exposure exists yet, so this is the phase-2 repair
path for a wrong publish. Extending `closesAt` before close is allowed (it delays reveal for everyone);
reopening after close is not — it requires a new assessment (new window, new snapshot). _Test:_ withdraw a scheduled run → draft,
publish corrected; extend before close → review remains locked; reopen after close →
`409 ASSESSMENT_CLOSED`.

**R13 — Items cannot be added to or removed from a live assessment.** _Test:_ composer edit on a live
assessment → `409 ASSESSMENT_LIVE`.

**R14 — Students never see that a sealed item exists.** No locked rows. The bank shows
_"N questions are held for your assessment until <date>"_; the count and the date are explicit, the
items are not. With several live windows the date is the **latest** close among them; a withheld item
past its date is shown as "held until released" (never a date that has already passed). _Test:_ student
bank payload omits the item; the notice count matches the reservation and the latest close.

**R15 — Export is staff-only and keyed for staff.** A staff export is attributed/watermarked and
refuses items sealed for a class the exporter cannot see. Student exports never contain keys. _Test:_
student export request → `403`; teacher export includes the key.

**R16 — Explanations are required for choice items and are the post-close teaching artefact.** Cap
**2 040 characters**, minimum 80. Open-text items require a **model answer** (not a key explanation);
until manual grading exists they are `ungraded` and excluded from both `earned` and `possible` (a
submission with only open items yields `possible: 0` and a score of `null`, not `0`). _Test:_
`PUT /items/:id` → `422` without them; review shows them; the score denominator excludes ungraded
items.

**R17 — Explanation text must not hand over an option.** Mechanical checks reject option
letters/ordinals ("B", "druga odpowiedź") and verbatim option text (normalised, ≥ 12 chars). Guidance:
name the distractor the student is likely to confuse. _Test:_ the validator rejects each case.

**R18 — Server-side grading reads the key; readers never do.** In production this is the column/
permission boundary (see #1165); in the MVP it is the API layer. _Test:_ the student API surface
cannot be made to return a key.

**R19 — Every refusal is a product state with a code**: `404` for an item sealed to you (identical to
nonexistent, no oracle), `403 REVIEW_LOCKED`, `403 EXPORT_FORBIDDEN`, `409 ATTEMPTS_CLOSED` / `ATTEMPTS_NOT_OPEN` /
`ATTEMPT_EXPIRED` / `ALREADY_SUBMITTED` / `ATTEMPT_IN_PROGRESS` / `NO_ATTEMPTS_LEFT` /
`NO_UNSEEN_ITEMS` / `ASSESSMENT_LIVE` / `ASSESSMENT_NOT_LIVE` / `ASSESSMENT_CLOSED` /
`ASSESSMENT_NOT_PUBLISHED` / `ASSESSMENT_ALREADY_PUBLISHED` / `ASSESSMENT_CANCELLED` /
`RELEASE_NOT_WITHHELD` / `RESERVATION_CONFLICT` / `EXPOSURE_ACK_REQUIRED`, `422` for explanation/
model-answer rules and invalid publish config.

**R20 — Managers may change windows but never unseal a live class.** Overrides shrink or extend
windows, resolve conflicts and author makeups; they cannot release a live reservation or un-reveal.

## Visibility matrix (student)

| Phase                                   | Item              | Correct option | Explanation    | Own correctness        | Classmates' answers | Aggregates |
| --------------------------------------- | ----------------- | -------------- | -------------- | ---------------------- | ------------------- | ---------- |
| Open item, before any assessment window | yes               | yes (practice) | yes (practice) | practice only          | no                  | no         |
| Sealed for their class (window live)    | **absent**        | **absent**     | **absent**     | —                      | no                  | no         |
| During an attempt                       | yes               | **no**         | **no**         | no                     | no                  | no         |
| Submitted, window open                  | yes               | **no**         | **no**         | score + `correct` flag | no                  | no         |
| Closed, review unlocked                 | yes               | **yes**        | **yes**        | yes                    | own only            | yes, n ≥ 5 |
| Next cohort                             | derived per class | derived        | derived        | —                      | no                  | yes, n ≥ 5 |

Screenshots, verbal sharing and shared devices are out of scope: the guarantee is "the system never
hands over the key", not "nobody can tell anyone".

## Flows

### 1. Authoring

Create/edit items; explanation required for choice items (R16/R17), model answer for open items. The
item table shows question, type, **sealed-for** (derived per class), explanation/model answer present,
used-in count.

### 2. Compose and publish

1. Teacher picks classes, window, `maxAttempts`, concepts/count or hand-picked items.
2. System forecasts eligibility per class and per student (ledger), shows shortfall **before** save.
3. Publish screen: reservation forecast per class, cross-class exposure **with blocking
   acknowledgement** (R3), optional org-wide seal, `taughtItem` / `withholdFromReview` flags.
4. Publish freezes versions (R11); reservations activate at `opensAt`.

### 3. Learning surface

Today a student learns from the **post-submission review**: sealed items are absent from the bank
(R14), and opening a reviewed item writes the exposure event (R8). Practice quizzes deliver their
feedback through the same review. A dedicated in-bank study/practice surface with immediate feedback
and a revisit queue is #1175 (needs-design); it writes the same event when it exists.

### 4. Take

Start attempt → `in_progress` with items carrying no key. Linear, no feedback, no route back to the
bank. Submit → `score` + per-item `correct` boolean. Attempts only inside the window (R7).

### 5. Close and reveal

`closesAt` (or an explicit close, which sets `closesAt := now`) → in-progress attempts expire;
reservations end except withheld items (R10); review unlocks for the whole cohort (R5). Review shows
key, explanation/model answer, "practise these" links.

### 6. Retake

Inside the window, up to `maxAttempts`, a fresh sample of items with no ledger event and no prior
answer for that student (R7). A same-item retake is possible only when the teacher allowed it and
also happens before close; it never withholds review (R6). After close, a makeup is a separate
assessment.

## Edge cases

- **Late joiner / accommodation:** extending `closesAt` before close delays everyone's reveal; after
  close the only path is a separate makeup assessment over unseen items, manager-gated. There is no
  "quiet extension" that leaks.
- **Assessment spanning classes:** one window, one reveal; reservations cover each targeted class.
- **Item edited while sealed:** new version; live assessment keeps its snapshot (R11).
- **Item retired/deleted:** new binding blocked; a published assessment keeps its frozen version.
- **Item added to a live assessment:** refused (R13).
- **Pre-exposed students:** warned at publish; excluded from their samples unless `taughtItem`.
- **Student withdraws/joins mid-window:** joining adds them to the cohort with an empty ledger; a
  retake samples unseen items for them.
- **Reserving an item for a class that already has it live:** `409 RESERVATION_CONFLICT` (same item,
  same class, overlapping window, different assessment). Cross-class overlap is not a conflict — it is
  R3's acknowledged exposure; managers may resolve a conflict, never unseal.
- **Open-text items:** model answer required; `ungraded` in the MVP (excluded from the denominator)
  or manually graded later.
- **Read-only colleague:** may include items in their own assessment (reserves them, notifies the
  owner); cannot see keys without the staff key permission.
- **Item reuse next term:** released at close; the new cohort's empty ledger seals it again for that
  class. Cross-cohort leak is social; rotation, not secrecy, mitigates it.
- **Aggregates:** suppressed below 5 respondents; with 12-student classes this may often show nothing.

## Contracts (app level, no RLS)

```
GET    /banks/:id/items            → student: sealed items omitted, no key fields, {heldCount, heldUntil}
                                     staff with key permission: key + explanation included
GET    /banks/:id/export           → staff only; keyed, attributed; 403 EXPORT_FORBIDDEN for students
POST   /practice/:bankId/answers   → {answers:[{itemId, value}]}
                                     → {results:[{itemId, correct?: boolean, graded: boolean,
                                                   explanation?, correctOption?, modelAnswer?}]}
                                     open (unsealed) item only; sealed → 404, no event
POST   /assessments/:id/attempts   → {attemptId, state:'in_progress', items:[{itemId, stem, type,
                                     options:[{id, content}]}]}
                                     409 ATTEMPTS_NOT_OPEN / ATTEMPT_IN_PROGRESS / NO_ATTEMPTS_LEFT /
                                     NO_UNSEEN_ITEMS
GET    /attempts/current           → 200 {attemptId, assessmentId, items} (same shape as start) | 404
POST   /attempts/:id/submit        → {score: {earned, possible} | null, ungradedCount,
                                      results:[{itemId, graded: boolean, correct: boolean | null}]}
                                     409 ALREADY_SUBMITTED / ATTEMPT_EXPIRED / ATTEMPTS_CLOSED
GET    /assessments/:id/review            → latest submitted attempt (tie-break by attempt id); renders the key, so it writes
                                     the exposure event (idempotent, one per item/student)
GET    /assessments/:id/attempts/:id/review → a specific submitted attempt; same exposure write
                                     403 REVIEW_LOCKED (before close / no attempt); 404 when show_results=false
                                     {attemptId, score: {earned, possible} | null, ungradedCount,
                                      items:[{itemId, graded, correct: boolean | null,
                                              explanation?, modelAnswer?, correctOption?}]}
POST   /assessments/:id/retake     → fresh sample; 409 NO_UNSEEN_ITEMS / ATTEMPTS_CLOSED / NO_ATTEMPTS_LEFT
POST   /assessments/:id/close      → sets closedAt := now, expires in-progress attempts, ends reservations
                                     (withheld items stay sealed); 409 ASSESSMENT_CLOSED /
                                     ASSESSMENT_NOT_PUBLISHED / ASSESSMENT_NOT_LIVE
POST   /assessments/:id/cancel     → closes a scheduled/live run; state `cancelled`; 409 ASSESSMENT_CLOSED
POST   /assessments/:id/withdraw   → scheduled → draft (no exposure yet); 409 ASSESSMENT_LIVE / ASSESSMENT_ALREADY_PUBLISHED
POST   /assessments/:id/extend     → {closesAt} before close; 409 ASSESSMENT_CLOSED; re-opens nobody's review
PUT    /assessments/:id            → 409 ASSESSMENT_LIVE when items/window change after publish
POST   /assessments/:id/items/:itemId/release → releases a withholdFromReview item; 409 RELEASE_NOT_WITHHELD
POST   /assessments/:id/publish    → validates classes/window/maxAttempts; 422 invalid, 409
                                     EXPOSURE_ACK_REQUIRED / ASSESSMENT_ALREADY_PUBLISHED / ASSESSMENT_CANCELLED
POST   /assessments/:id/override   → manager: extend/shrink window, resolve RESERVATION_CONFLICT;
                                     cannot unseal a live class or un-reveal
PUT    /items/:id                  → 422 for explanation/model-answer rules (per-field paths)
GET    /quiz/:attemptId                   → practice-quiz review; renders the key, so it writes the
                                     same exposure event (and the existing assignment review path does too)
GET    /items/:id/ledger           → staff: exposure events + pre-exposed counts
```

Errors (every refusal carries one of these in `error`): `404` sealed-or-nonexistent (no oracle),
`403 REVIEW_LOCKED` / `EXPORT_FORBIDDEN`, `409 ATTEMPTS_CLOSED` / `ATTEMPTS_NOT_OPEN` / `ATTEMPT_EXPIRED` /
`ALREADY_SUBMITTED` / `ATTEMPT_IN_PROGRESS` / `NO_ATTEMPTS_LEFT` / `NO_UNSEEN_ITEMS` /
`ASSESSMENT_LIVE` / `ASSESSMENT_NOT_LIVE` / `ASSESSMENT_CLOSED` / `ASSESSMENT_NOT_PUBLISHED` /
`ASSESSMENT_ALREADY_PUBLISHED` / `ASSESSMENT_CANCELLED` / `RELEASE_NOT_WITHHELD` /
`RESERVATION_CONFLICT` / `EXPOSURE_ACK_REQUIRED`, `422` with per-field paths.

Aggregates in review are **counts only** — `graded`, `correct`, `ungraded` per item, over submitted
attempts in the cohort, suppressed below **5 respondents**. Never option-level distributions (that
would be the key). Bank payloads for students carry `heldCount` and `heldUntil` (R14), never item ids.

An injectable clock (`now`) is part of the MVP contract so window boundaries are testable.

## Throwaway MVP (in memory, no RLS)

Purpose: feel the model and the rules; prove the contracts; not a production build.

- **In-memory store + the contract handlers above**, mounted in the page; the UI calls the same
  functions the tests call. Nothing persists; reload resets.
- **Account switcher**: Teacher A (owner), Teacher B (colleague), Manager, Student 8A/1, 8A/2,
  8B/1, 8C/1. No auth.
- **Seed**: 3 classes (8A, 8B, 8C), ~20 items across 2 banks, one scheduled assessment for 8A.
- **Screens**: Bank (items with derived sealed state, author form with explanation rules), Practice,
  Composer (classes, window, attempts, sampling forecast, warnings, flags), Take, Results/Review,
  Ledger, Clock control (advance to open/close).
- **Behaviours to feel**:
  1. Reserving for 8A seals items for 8A only; 8B still practises.
  2. Practising writes a ledger event; publish shows pre-exposed counts and blocks without
     acknowledgement.
  3. Submit → score + flags only; review locked until close; advancing the clock unlocks it.
  4. Close → review reveals key/explanation; withheld items stay sealed and absent until released.
  5. Retake inside the window draws a disjoint sample; after close → `ATTEMPTS_CLOSED`.
  6. A same-item retake is possible in-window and does **not** withhold review at close.
  7. Edit a sealed item → new version; the live assessment unchanged.
  8. Explanation validation: missing, too short, "B"/ordinal, verbatim option.
  9. Cross-class warning and the org-wide seal toggle.
  10. A sealed item requested directly → 404 identical to a nonexistent item.

## Contract tests the MVP must pass

1. Sealed item absent from the student bank payload; present for 8B; no key fields at all.
2. Staff list includes key + explanation.
3. Practice on an open item returns correctness + explanation and writes exactly one event.
4. Practice on a sealed item → 404, no event.
5. Start attempt → `in_progress`, no key fields, stable `attemptId`; second start → 409.
6. Submit → score/ungraded per item; no key; second submit → 409; after close → 409.
7. Review → 403 before close; 200 at close for every student, including one with an unused attempt.
8. Close → review shows key/explanation; withheld item absent and still sealed.
9. Retake draws a disjoint sample; exhausted inventory → 409 `NO_UNSEEN_ITEMS`.
10. Publish without acknowledging cross-class exposure → `409 EXPOSURE_ACK_REQUIRED`; invalid
    classes/window/maxAttempts → `422`; with ack → per-class reservations;
    org-wide toggle seals every class.
11. Item validation: 422 for missing/short explanation, "B"/ordinal, verbatim option; model answer
    required for open items.
12. Edit a bound item → new version; frozen `AssessmentItem.version` unchanged.

## Acceptance criteria (production build)

1. A student payload for a sealed item contains no correct-answer field.
2. A direct data read cannot return `is_correct` to a student **at all** for a reader-facing path —
   the phase 1 column revoke is unconditional, before any seal-aware projection (see #1165).
3. Review is unreachable before close; at close it unlocks for the whole cohort.
4. Retakes never repeat an item the student has seen, unless explicitly allowed and flagged.
5. Publish blocks on cross-class exposure and warns about pre-exposed items.
6. Editing a bound item never changes a live assessment.
7. Reveal happens at the single assessment close, cohort-wide.
8. Explanation (choice) and model answer (open) are required and pass the mechanical checks.
9. Exposure events are recorded from phase 2 onward (review included), not retroactively.
10. Attempts cannot start or submit outside the window.

## Phased build (after MVP validation)

The phases map to the epic's issues (phases 2 and 5 split #1171/#1174 scope; each phase is a
shippable PR sequence within the 400-line budget, and 1 → 2 → 3 is a real dependency chain).

1. **Database boundary** (#1170, independent): revoke the key column, author-scoped writes, one
   server-side key reader, reader-safe projections/export; fix the classmates'-answers row policy
   (#1165). _Migration first, app in the same release._
2. **Items in time** (#1171): open/retired/deleted items, per-group/per-student reservations from window open,
   frozen snapshots, publish-once, **durable close**, sealed items absent from practice/browse/export,
   close-time reveal, withheld items + release, blocking cross-class acknowledgement, held notices,
   and withdraw-to-draft for a scheduled run (publish-once applies from live). **Exposure events start here** (the review is the first
   surface that renders a key). _Migrations first, app in the same release._
3. **Exposure ledger** (#1172): eligibility per student (ledger + prior answers), `taughtItem` waiver,
   pre-exposed warnings and fairness flags. Recording already exists from phase 2.
4. **Explanation/model answer** (#1173): required for choice items, 2 040 cap, mechanical checks,
   model answer for open, review rendering.
5. **Lifecycle extras** (#1174): cancel, window extension, manager override, in-window attempt rules,
   fresh-sample retakes (and same-item retake flag), per-attempt review, makeup semantics.
6. **Study surface** (#1175, needs-design): open items + explanations without an attempt; writes the
   same exposure event. Not blocking 1–5.

## Residual risk

- A determined student shares a screenshot after close; rotation, not secrecy, mitigates cross-cohort
  reuse.
- Per-class reservation (decision a) still allows cross-class leakage; the blocking acknowledgement
  and the org-wide toggle make it a decision rather than an accident.
- Inventory is the real cost: a class needs several times the items of one quiz for fresh-sample
  retakes and unseen sampling.
- Aggregates are suppressed below 5 respondents, so small classes may see no statistics at all.

## Open questions

- Should `withholdFromReview` default to on for items re-used within 12 months?
- Is a dedicated **study set** surface (open items + explanations, no attempts) needed for mandatory
  explanations to pay off?
- Open-text grading: manual now, or `ungraded` until a rubric workflow exists?
- Does the org-wide toggle need a manager approval, or is the teacher's acknowledgement enough?
- Is a same-item retake worth shipping at all, given it shows the same items twice inside one window?
