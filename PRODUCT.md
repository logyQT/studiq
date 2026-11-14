# PRODUCT.md

What StudiQ is, who buys it, and what is true today. Design work reads this before
touching a page: the visual direction lives in [DESIGN.md](DESIGN.md), and this file
is the source of truth for every claim the product makes.

## What StudiQ is

A study and exam-prep platform where a student's own course material becomes practice:
flashcards with spaced repetition, question banks, timed quizzes, and progress stats.
Educators build those banks for their classes; institutions manage members, roles and
groups from one place.

One codebase, three account types: `STUDENT`, `EDUCATOR`, `MANAGER`.

## Status

**Pre-market. Not launched.** Target is Nov/Dec 2026, and the deliverable is the scope in
[docs/ROADMAP.md](docs/ROADMAP.md) and nothing beyond it: this is a course project, and
features outside that roadmap are deliberately out of scope.

That has one consequence for every landing page, ad and pricing card: **nothing on them
may imply a customer base that does not exist yet.** No usage counters, no testimonials,
no "trusted by". The page sells what the product does, not who supposedly uses it.

## Who it buys

| Buyer                      | Account type | What they are replacing                                     | What they actually want                                      |
| -------------------------- | ------------ | ----------------------------------------------------------- | ------------------------------------------------------------ |
| Student, mid-exam-season   | `STUDENT`    | Quizlet, Anki, a shared Google Doc of questions             | Get through the next exam without building 400 cards by hand |
| Lecturer running a course  | `EDUCATOR`   | Paper question lists, Moodle quiz module, Kahoot for review | One bank reused across groups, without re-typing every term  |
| Programme or faculty admin | `MANAGER`    | Spreadsheets, shared logins, "who has access?" emails       | Seats, roles and per-group visibility they can audit         |

The student is the volume buyer and the only one who converts alone. Educators and
institutions are the revenue, and they arrive through a human conversation, not a
self-serve checkout. The landing page therefore has two exits: `/register` and
`/contact`. It is not one funnel.

## The job

The thing people already do is _build their own practice material by hand_. StudiQ
shortens that to: bring the material, get practice out, see what is still weak
(`SM-2` scheduling, per-topic accuracy, weak-spot review).

The wedge is not "AI". AI is how the material gets in. The wedge is **your own course
material, not a generic deck** — a question bank keyed to the lecture the exam is on,
shared with the group that sits it.

## What ships today

Verified against `docs/ROADMAP.md` on 2026-11-14:

- Flashcards, decks, topics, `SM-2` practice, study sessions, cram mode, CSV import and
  export, media upload, suspend/restore
- Questions (multiple choice, true/false, open), question banks, quizzes, attempts, review
- Groups, org hierarchy, per-role permissions with `own / group / organization / any`
  scopes, RLS on every public table
- Plans, features and limits gating, seats, Stripe driver (mock is the dev/test default;
  production is Stripe-only)
- Polish and English, full RTL-safe layout primitives unused so far
- AI: **flashcard generation from text or PDF** through the agent, with a daily token budget

## Launch blockers

These are promises the product makes that the code does not keep yet. Each one is a
choice: ship it, or remove it.

1. **AI question and quiz generation** — `LandingPage.ai_generate_questions` is advertised
   on the landing page and the Premium pricing card. QuestionAgent is issue #658, still
   planned. Today only _flashcard_ generation works.
2. **AI exam simulation** — advertised as `LandingPage.ai_exam_sim`. Adaptive difficulty
   and exam simulation are deferred (subphase 4C). Not started.
3. **"Free Forever"** (`LandingPage.free_badge`) — a permanent pricing promise made by a
   pre-market product. Either commit to it in writing or soften it before launch.

Items 1 and 2 are the serious ones: they are listed value on a paid tier. A visitor who
subscribes to Premium for AI question generation today pays for something that returns
nothing.

## What the landing page owes the visitor

One job: **make a student believe this will save them time on the exam they are actually
facing, then get them to `/register` in under a minute.** Everything else is secondary.
Secondary but real: a lecturer or admin has to be able to tell within the same scroll that
there is an institutional product behind it, and click `/contact`.

So the page carries, in order: what it does with your material, what it looks like when
you use it, what it costs, and one way in. Proof arrives when there is proof.

## Voice

Direct, plain, specific. Polish is the default locale, so Polish copy is the primary
draft and English follows it, not the reverse.

- Say the concrete thing: "turn your lecture slides into a question bank", not
  "AI-powered learning".
- No superlatives we cannot measure ("the best", "#1", "world-class").
- No hedged feature verbs ("helps you to", "empowers"). Name the action.
- No em dashes in marketing copy. Short sentences, full stops.
- Every number on the page must be either measured in the app or absent.

## References

- [DESIGN.md](DESIGN.md) — visual system, palette, type, motion, anti-patterns
- [docs/ROADMAP.md](docs/ROADMAP.md) — what is in scope, and its status legend
- [docs/ai.md](docs/ai.md) — agent architecture and current AI capability
- [AGENTS.md](AGENTS.md) — engineering conventions this product ships under
