# StudiQ product

Design work reads this before touching a page: the visual direction lives in the
[design system](DESIGN.md), and this file is the source of truth for what the product may
claim.

## What StudiQ is

A study and exam-prep platform where a student's own course material becomes practice:
flashcards with spaced repetition, question banks, timed quizzes, and progress stats.
Educators build those banks for their classes; institutions manage members, roles and
groups from one place.

One codebase, three account types: `STUDENT`, `EDUCATOR`, `MANAGER`.

## Status

**Pre-market. Not launched.** Target is Nov/Dec 2026. The deliverable is the scope in
[the roadmap](docs/ROADMAP.md): this is a course project.

**Every roadmap feature ships before launch.** That is the rule this document turns on:

> The page is written against the **roadmap**, not against what `main` wires up today.
> A feature listed in the roadmap may be sold now, even if its UI is still landing.

The app code is the implementation status. The roadmap is the promise. A feature that is
**not** in the roadmap gets no claim, however plausible it sounds.

One separate and absolute rule: **nothing on the page may imply a customer base that does
not exist.** No usage counters, no testimonials, no "trusted by". Those were removed and do
not come back until they are measured.

## Who buys it

Two ladders, each self-serve through Stripe from `/pricing`:

| Ladder      | Account type                     | Free tier | Paid tiers                                |
| ----------- | -------------------------------- | --------- | ----------------------------------------- |
| Individual  | `STUDENT`, `EDUCATOR`, `MANAGER` | `base`    | `spark` 19.99 · `ace` 39.99 · `pro` 79.99 |
| Institution | `MANAGER`                        | `launch`  | `team` 99 · `hub` 299 · `campus` 699      |

All prices in PLN per month, from `subscription_plans`. Never hardcode them: the landing
reads `/api/v1/subscription-plans` and formats through `formatPlanPrice`.

What each buyer replaces, and what they want:

| Buyer                      | Replacing                                                   | Wants                                                        |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| Student, mid-exam-season   | Anki, Quizlet, a shared doc of questions                    | Get through the next exam without building the cards by hand |
| Lecturer running a course  | Paper question lists, Moodle quiz module, Kahoot for review | One bank reused across groups, without retyping every term   |
| Programme or faculty admin | Spreadsheets, shared logins, "who has access?" emails       | Seats, roles and per-group visibility they can audit         |

Two conversion actions, not two funnels: `/register` for students and educators, `/contact`
for institutions. `/contact` is today a static mailto page with no form, so it captures no
lead. Treat institution outreach as a page problem with a known hole, not a solved path.

## The job

People already build their own practice material by hand. StudiQ shortens that to: bring
the material, get practice out, see what is still weak.

The wedge is not "AI". AI is how the material gets in. The wedge is **your own course
material, not a generic deck**: a question bank keyed to the lecture the exam is on, shared
with the group that sits it. Every competitor can generate cards from a topic; almost none
start from the PDF the lecturer actually handed out.

## The brief

What the landing page has to do, in one screen and then in seven.

**Hero claim (draft, validate before building):** _"Twoje własne materiały, zamienione w
ćwiczenia, których potrzebujesz w tym tygodniu."_ One sentence, says the mechanism
(your material), the output (practice), and the deadline (this week). If it does not
survive the objections below, the claim is wrong, not the objection.

**The objection the visitor arrives with, and its answer:**

| Objection                                | Answer                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| "Anki is free and I already have decks." | Anki schedules cards; it does not build a question bank or a timed quiz, and it does not share a bank with your group. |
| "AI cards are garbage."                  | The agent extracts concepts from your file and runs a quality check, and every card stays editable.                    |
| "Is this in Polish?"                     | Polish is the default locale. English second.                                                                          |
| "Will it cover my syllabus?"             | It is built from your material, topic by topic, not from a generic deck.                                               |

**Proof available today is the product itself.** The strongest thing on the page is that the
UI shown is the UI you get: imagery is rendered by the product's own components with fixture
data, so signing up delivers exactly what the page previewed. That beats any screenshot,
because a capture freezes a claim that drifts as the product moves.

What may **not** appear: any number about usage, any quote from a person, or a hand-built
lookalike of the interface. Re-using the real component is proof; re-drawing it is a
fabrication.

**Section order.** `#hero` → `#features` → `#how-it-works` → `#pricing` → `#get-started`.
That order is not a suggestion: `__tests__/qa/PUB/PUB-01.spec.ts` pins the presence of those
five ids, one `<h1>` inside `#hero`, a heading per section, no empty section, `lang="pl"`,
and the header and footer link targets. Renaming or removing a section means updating the
spec and `qa/cases/PUB-01.md` in the same change.

### A surface visited once

The homepage is not a place people return to. They arrive once, or they never arrive at all because they come back straight to `/login` or a deep link. GitHub is the same shape: a near-static front page that still has to work for someone who has never seen the product and will judge it in one scroll.

Three consequences, and they decide arguments that otherwise run in circles:

- **The menu is orientation, not a navigation system.** It needs a few large, unambiguous destinations and one action, not every route in the app. Depth lives in the product, behind a sign-in, where people actually navigate.
- **One primary action, aimed at the first-time visitor.** Sign up. Someone returning already knows the account mark exists in the top-right, because it is in the same corner after sign-in as before it.
- **Nothing may assume a second visit.** No "welcome back", no personalisation, no tour that only makes sense after onboarding. Everything needed to decide has to be on this one page, in the first screens.

That is why the phone menu is a full-page takeover with four oversized rows and a single button, rather than a drawer full of links: a drawer exists to keep the page visible while you navigate around it, and there is nowhere here to navigate around.

Roadmap-backed, so all of it is sellable. Status column is the roadmap's, not the code's.

| Claim                                                                           | Roadmap         | Status                                         |
| ------------------------------------------------------------------------------- | --------------- | ---------------------------------------------- |
| Flashcards, decks, topics, cram mode, CSV import/export, media upload           | 0               | ✅                                             |
| `SM-2` spaced repetition and study sessions                                     | 0, 5B           | ✅                                             |
| Questions (multiple choice, true/false, open), banks, quizzes, attempts, review | 0, 3A           | ✅                                             |
| Groups, org hierarchy, roles, per-group visibility                              | 1, 2            | ✅                                             |
| Own branding: organization logo and brand colour                                | 8A              | ✅                                             |
| Seats, plans, features and limits, Stripe checkout                              | 6               | 🏗️ integration complete, go-live pending #1019 |
| AI flashcard generation from text or PDF, with a daily token budget             | 4A              | ✅                                             |
| AI question and quiz generation                                                 | 4B (#658)       | 📋 ships before launch                         |
| Notes agent and tutor mode                                                      | 4B (#659)       | 📋 ships before launch                         |
| `/summary`, `/quiz`, `/explain` commands                                        | 4B (#660)       | 📋 ships before launch                         |
| YouTube, image and audio input                                                  | 4B (#661)       | 📋 ships before launch                         |
| Document support                                                                | 3C (#653)       | 📋 ships before launch                         |
| Question bank polish                                                            | 3B (#651, #652) | 📋 ships before launch                         |
| Teacher dashboard                                                               | 3D (#654)       | 📋 ships before launch                         |
| Advanced statistics: study time, mastery, retention                             | 5C (#657)       | 📋 ships before launch                         |
| Global admin statistics                                                         | 7 (#663)        | 📋 ships before launch                         |
| Polish and English                                                              | 0               | ✅                                             |

The page may sell the 📋 rows. It may not sell anything absent from this table.

## Gaps: claimed, but not in the roadmap

One claim is live and has no roadmap row. Under the rule above it gets no promise until it
does. It is a decision, not a design task.

1. **"Free Forever"** (`LandingPage.free_badge`). The free-tier band is badged "Free Forever"
   / "Zawsze za darmo". The free plan is 0 zł today, but "forever" is a pricing promise, and
   the roadmap makes none: nothing in it or in `subscription_plans` fixes that price. Either
   back it with a policy decision or drop the badge from the band. The badge is on the landing
   page's pricing band, not on `/pricing`, so this redesign does not touch it.

**Closed by the `/pricing` redesign.** The FAQ used to answer a 14-day trial and a 30-day
retention window. Both described a product the roadmap does not have, so both are gone and
the page now states only what the roadmap backs. Recorded because both are tempting to
re-add:

- **There is no trial.** Checkout creates a plain subscription (`stripe-payment.gateway.ts`):
  no trial period, no trial plan, no roadmap row for one.
- **Cancellation deletes nothing.** It sets `cancel_at_period_end`, so the plan falls back to
  the free tier when the paid period ends and the account, its material and its groups stay.
  There is no 30-day window to describe.
- **A downgrade prunes nothing.** Limits are read live from the plan when content is created,
  so material already above a cheaper plan's limits stays and stays readable; the reader
  simply cannot add more past the new cap.

**Dropped:** AI exam simulation. It was sold as Premium value on the landing page, the
marketing premium card and `/features`, and subphase 4C covers learning paths, report agents
and adaptive difficulty — not exam simulation. It is gone from all three surfaces and its
keys with it; it returns only when the roadmap has a row for it.

Separately, one entitlement inconsistency that is not a roadmap question: the landing org
card prices from `team` (99 zł) and lists "Everything in Premium", but `ace` (19.99 zł) is
the plan carrying `ai.chat` and `stats.insights`, and `team` carries neither. At five times
the price, the cheap institutional tier includes less than the individual one. Fix the
seed or fix the bullet, but the current pair cannot both be true.

## Voice

Direct, plain, specific. Polish is the default locale and the primary draft; English must
make the same claim, not a different one. The hero is the reference pair: `pl.hero_title` is
"Ucz się tylko tego, co potrzebne." and `en.hero_title` is "Study only what you need." Both
make the learner the actor and scope the claim to what the material requires.

- Say the concrete thing: "turn your lecture slides into a question bank", not
  "AI-powered learning".
- No superlatives without a measurement: "the best", "#1", "world-class".
- No hedged verbs: "helps you", "empowers", "supercharge". Name the action.
- No "AI-powered" as an adjective or a badge. It is the least informative phrase available
  about a product that does something specific. The two strings that broke this,
  `LandingPage.hero_badge` and `LandingPage.ai_exam_sim`, are gone: the badge names where the
  material comes from, and the exam simulation was dropped with its keys.
- No dashes as punctuation, in either locale. `pl.LandingPage.hero_subtitle` was the one
  sentence that broke this with a spaced hyphen; it has been rewritten, so the landing copy
  now obeys the rule in both catalogues.
- Every number on the page is measured in the app or absent.

## References

- [Design system](DESIGN.md): palette, type, motion, anti-patterns
- [Roadmap](docs/ROADMAP.md): the promise surface, and the status legend
- [Plans, features and limits](docs/limits.md): entitlement resolution
