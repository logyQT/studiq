# Learning and assessment: the exposure model

**Status:** draft v2 — corrected after three independent spec reviews (state machine, pedagogy/fairness,
testability/MVP). No implementation yet.
**Supersedes the framing in:** #678 (answer key visible to readers), #1165 (answer key reachable
through PostgREST).

## The problem

Question banks serve two activities with contradictory requirements:

- **Learning** needs feedback: the correct answer, an explanation, and unlimited retries.
- **Assessment** needs secrecy: no way to learn the answer before the grade is final.

Today one pool serves both. That was harmless while everything was self-practice; it became a
correctness problem the moment graded assessments were built on the same items:

- the answer key is reachable before and during an assessment (bank browsing, practice review,
  keyed CSV export, direct data access);
- practice reveals the key, and review offers "start another attempt" over the same fixed set;
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
| g   | Ledger            | **Record from day one** (MVP and phase 3), even if eligibility enforcement ships later                   |

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
- Production database/RLS work: this spec defines contracts; the throwaway MVP demonstrates them in
  memory.

## Personas

| Actor                                  | Can                                                                                           | Cannot                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Teacher** (bank owner)               | author items, see keys/explanations, reserve, compose, grade, review                          | rely on discipline instead of enforcement                                                                                                   |
| **Colleague** (can read a shared bank) | include its items in an assessment they own (reserves them, owner notified)                   | edit the bank; see keys without `answers.read`                                                                                              |
| **Manager**                            | override reservations, see fairness reports, resolve disputes, author makeups                 | unreserve a live class, un-reveal                                                                                                           |
| **Student**                            | practise open items, take assigned assessments, see their own score, read reviews after close | read a key for a sealed item, read classmates' answers, retake unless the teacher allowed it, retake the same set unless explicitly enabled |

**Class** is the isolation unit for reservation and reveal. A student has one class per org context in
this model. **Cohort** = the classes an assessment targets; a **makeup** is a separate assessment.

## Domain model

| Entity            | Fields (conceptual)                                                                                                                               | Notes                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Bank`            | id, org, owner, name, readers                                                                                                                     | curation only; **no type**                                                                |
| `Item`            | id, bank, stem, type (`mcq`/`true_false`/`open`), options, correct option, explanation, modelAnswer, version, status (`open`/`retired`/`deleted`) | edits after binding create a new version                                                  |
| `Assessment`      | id, org, owner, classes[], `opensAt`, `closesAt`, state (`draft`/`scheduled`/`live`/`closed`), scoring rules, `maxAttempts`                       | **one window**                                                                            |
| `AssessmentItem`  | assessment, item, version, flags (`taughtItem`, `withholdFromReview`)                                                                             | immutable once published                                                                  |
| `Reservation`     | item, assessment, classes[], effective window                                                                                                     | **derived**: active from `opensAt` to `closesAt` (or explicit release for withheld items) |
| `Attempt`         | assessment, student, state (`in_progress`/`submitted`/`expired`), started/finished, score, answers                                                | one in progress at a time; attempts only in-window                                        |
| `Answer`          | attempt, item, submitted value, correctness (`correct`/`incorrect`/`ungraded`)                                                                    | never exposed before reveal                                                               |
| `PracticeEvent`   | student, item, class, `seenCorrect: true`, timestamp                                                                                              | the **exposure ledger**; written when feedback renders                                    |
| `PracticeAttempt` | student, bank/item set, answers, score                                                                                                            | unlimited, no stakes                                                                      |

### Derived visibility

```text
// per student, per item
sealed(item, student) := exists active Reservation r where
    r.item = item
    and student.class ∈ r.classes
    and now ∈ [r.opensAt, r.closesAt)          // or r held open by withholdFromReview

eligible(item, student) := not sealed(item, student)
    and no PracticeEvent(item, student)        // unless the assessment item is taughtItem
    and no Answer(item, student)               // the student has never been shown it in an attempt

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

**R1 — Banks never gate answers.** Only item reservation and the `answers.read` permission do. Every
student read path filters sealed items and strips `correct`/`explanation`.

**R2 — Reservation is per class and active only inside the assessment window.** Reservations are
created at publish as a _forecast_ and become effective at `opensAt`; they end at `closesAt` (with
R10's withheld exception). _Test:_ 8A's test seals 20 items for 8A from open to close; 8B practises
them freely before and during 8A's window.

**R3 — Cross-class exposure is a blocking acknowledgement, not a dismissible warning.** On publish the
composer lists items still open to other classes and requires an explicit acknowledgement; each
assessment offers **"seal for the whole org"** (then all classes' reservations include it). The
default stays per class per decision (a). _Test:_ publish without acknowledgement is rejected; with
it, reservations target the assessment's classes; with org-wide, all classes.

**R4 — No key reaches a student for a sealed item on any path** — browsing, practice, exports, debug
payloads, or direct data reads (the last is a database-boundary rule in production). _Test:_ the
student payload contains no `correct`/`explanation` field at all (absent, not null).

**R5 — Answers reveal at close, cohort-wide, for everyone.** Immediately after submit a student sees
`score` and per-item `correct: boolean` only. At `closesAt`, review unlocks for every student in the
cohort — an unused attempt allowance simply expires (attempts cannot exist after close, R7). _Test:_
review endpoint `403 REVIEW_LOCKED` before close; 200 for a student who used one of three attempts,
and for one who used none.

**R6 — Same-item retakes are an in-window choice, not a review gate.** `allowSameItemRetake` lets a
student retake the same set up to `maxAttempts` _before_ close; it never withholds review afterwards.
Fresh-sample retakes are the default. _Test:_ both retake modes finish inside the window and review
unlocks at close with no special case.

**R7 — Retakes happen inside the window and draw a fresh sample.** Up to `maxAttempts`; an
in-progress attempt at close expires, counts as consumed, and cannot be submitted. After close no new
attempt is possible; a makeup is a new assessment over items with no exposure event for that student.
_Test:_ retake after close → `409 ATTEMPTS_CLOSED`; retake sample disjoint from prior attempts.

**R8 — Practice feedback burns the item for that learner.** Feedback (key/explanation) rendering
writes a `PracticeEvent`. An item with an event is excluded from that student's graded sample unless
the teacher marks it `taughtItem`. _Test:_ practise → publish warning count → the student's sample
omits it.

**R9 — Deliberate pre-exposure is declared, not forbidden.** `taughtItem` grades a taught item: it
scores, is labelled in results, and is excluded from fairness reporting. It does **not** unseal the
item during the window (R2/R4 still apply). _Test:_ `taughtItem` is eligible despite a ledger event,
the key is still hidden while live.

**R10 — `withholdFromReview` keeps an item sealed after close** until the teacher (or a manager)
explicitly releases it; item-level withholding outranks the automatic release at `closesAt`, and it
keeps the item sealed for the targeted classes, not just hidden in the review payload. _Test:_ after
close the withheld item is absent from review and still sealed for that class; `POST
/assessments/:id/items/:itemId/release` makes it visible and practiceable again.

**R11 — Items are frozen at publish.** Editing an item after publish creates a new version; the
assessment serves the published version. _Test:_ edit bound item → live assessment unchanged; new
practice sees the new version.

**R12 — An assessment has exactly one window and one class set.** Extending `closesAt` before close is
allowed (it delays reveal for everyone); reopening after close is not — it requires a new assessment.
_Test:_ extend before close → review remains locked; reopen after close → `409 ASSESSMENT_CLOSED`.

**R13 — Items cannot be added to or removed from a live assessment.** _Test:_ composer edit on a live
assessment → `409 ASSESSMENT_LIVE`.

**R14 — Students never see that a sealed item exists.** No locked rows. The bank shows
_"N questions are held for your assessment until <date>"_; the count and the date are explicit, the
items are not. _Test:_ student bank payload omits the item; the notice count matches the reservation.

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
nonexistent, no oracle), `403 REVIEW_LOCKED`, `403 EXPORT_FORBIDDEN`, `409 ATTEMPTS_CLOSED` /
`409 NO_UNSEEN_ITEMS` / `409 ASSESSMENT_LIVE` / `409 ASSESSMENT_CLOSED` / `409 RELEASE_NOT_WITHHELD` /
`409 RESERVATION_CONFLICT`, `422` for explanation/model-answer rules.

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

### 3. Practice

Student opens a bank; sealed items are absent (R14). Answer → immediate correctness + explanation →
ledger event (R8). Unlimited retries; errors enter a revisit queue.

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
- **Reserving an item another class has live:** `409 RESERVATION_CONFLICT` (same item, same class,
  overlapping window, different assessment); managers may resolve, never unseal.
- **Open-text items:** model answer required; `ungraded` in the MVP (excluded from the denominator)
  or manually graded later.
- **Read-only colleague:** may include items in their own assessment (reserves them, notifies the
  owner); cannot see keys without `answers.read`.
- **Item reuse next term:** released at close; the new cohort's empty ledger seals it again for that
  class. Cross-cohort leak is social; rotation, not secrecy, mitigates it.
- **Aggregates:** suppressed below 5 respondents; with 12-student classes this may often show nothing.

## Contracts (app level, no RLS)

```
GET    /banks/:id/items            → student: sealed items omitted, no key fields
                                     staff with answers.read: key + explanation included
POST   /practice/:bankId/answers   → {itemId, value}[] → open items: correctness + explanation +
                                     one ledger event; sealed item → 404, no event
POST   /assessments/:id/attempts   → {attemptId, state:'in_progress', items:[{itemId, stem, type,
                                     options:[{id, content}]}]}
                                     409 NO_UNSEEN_ITEMS when nothing eligible remains
GET    /attempts/current           → 200 in-progress attempt or 404
POST   /attempts/:id/submit        → {score:{earned,possible}, results:[{itemId, correct:boolean}]}
                                     second submit / after close → 409
GET    /assessments/:id/review     → 403 REVIEW_LOCKED until close; then
                                     {items:[{itemId, correct, explanation?, modelAnswer?}]}
POST   /assessments/:id/retake     → fresh sample; 409 NO_UNSEEN_ITEMS / 409 ATTEMPTS_CLOSED
POST   /assessments/:id/close      → sets closesAt := now, expires in-progress attempts, ends
                                     reservations (withheld items stay sealed)
POST   /assessments/:id/items/:itemId/release → releases a withholdFromReview item (teacher/manager);
                                     409 RELEASE_NOT_WITHHELD otherwise
POST   /assessments/:id/publish    → requires acknowledgement when cross-class exposure exists;
                                     409 without it
PUT    /items/:id                  → 422 for explanation/model-answer rules (field paths)
GET    /items/:id/ledger           → staff: exposure events + pre-exposed counts
```

Errors: `404` sealed-or-nonexistent (no oracle), `403 REVIEW_LOCKED` / `EXPORT_FORBIDDEN`,
`409 ATTEMPTS_CLOSED` / `NO_UNSEEN_ITEMS` / `ASSESSMENT_LIVE` / `ASSESSMENT_CLOSED` /
`RELEASE_NOT_WITHHELD` / `RESERVATION_CONFLICT`, `422` with per-field paths.

Aggregates in review are computed over **submitted attempts in the cohort** and suppressed below
**5 respondents**; a class of 12 may therefore show none. Bank payloads for students carry
`heldCount` and `heldUntil` (R14), never item ids.

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
6. Submit → score + boolean per item; no key; second submit → 409; after close → 409.
7. Review → 403 before close; 200 at close for every student, including one with an unused attempt.
8. Close → review shows key/explanation; withheld item absent and still sealed.
9. Retake draws a disjoint sample; exhausted inventory → 409 `NO_UNSEEN_ITEMS`.
10. Publish without acknowledging cross-class exposure → 409/422; with it → per-class reservations;
    org-wide toggle seals every class.
11. Item validation: 422 for missing/short explanation, "B"/ordinal, verbatim option; model answer
    required for open items.
12. Edit a bound item → new version; frozen `AssessmentItem.version` unchanged.

## Acceptance criteria (production build)

1. A student payload for a sealed item contains no correct-answer field.
2. A direct data read cannot return `is_correct` for a sealed item to a student (database boundary;
   see #1165).
3. Review is unreachable before close; at close it unlocks for the whole cohort.
4. Retakes never repeat an item the student has seen, unless explicitly allowed and flagged.
5. Publish blocks on cross-class exposure and warns about pre-exposed items.
6. Editing a bound item never changes a live assessment.
7. Reveal happens at the single assessment close, cohort-wide.
8. Explanation (choice) and model answer (open) are required and pass the mechanical checks.
9. Exposure events are recorded from day one.
10. Attempts cannot start or submit outside the window.

## Phased build (after MVP validation)

1. **Database boundary** (independent): revoke the key column, author-scoped writes, one server-side
   key reader, reader-safe projections/export; fix the classmates'-answers row policy (#1165 and the
   leak it uncovered). _Migration first, app in the same release._
2. **Items in time**: open/retired/deleted, per-class reservations from window open, frozen
   snapshots, sealed items absent from practice/browse/export, close-time reveal, blocking publish
   warnings.
3. **Exposure ledger**: record events, pre-exposed counts, fairness reports.
4. **Explanation/model answer**: required, 2 040-char cap, mechanical checks, review rendering.
5. **Reuse and rotation**: release-on-close, retirement after repeated binding, withheld items,
   fresh-sample retakes, same-item retake flag.
6. **Later**: variants and item families, item analytics, AI-assisted explanations, study sets.

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
