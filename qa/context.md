# Global context — StudiQ manual test plan

_Adapted English extract of sections 1-4 and the defect-template section of the source document. STU-25 is excluded from the active corpus. Read this once per session._

STUDIQ

Tester document – manual tests

Scenarios, steps and checkboxes for every application feature

| Field                  | Value                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document version       | 1.3 (2026-10-17)                                                                                                                                                              |
| Application under test | StudiQ – web app (port 3000) and admin panel (port 4000)                                                                                                                      |
| Code version           | `main` (commit 216daae) + PR #128 (plan form in admin) + PR #130 (user management with a 30-day bin) – until both merge, test them on the `feat/admin-user-management` branch |
| Scenario count         | 214 (P1: 60, P2: 149, P3: 5)                                                                                                                                                  |
| Tester (full name)     |                                                                                                                                                                               |
| Start / end date       |                                                                                                                                                                               |
| Final result           | PASS / PASS WITH COMMENTS / FAIL                                                                                                                                              |

# 1. Purpose and scope

This document walks the tester through a manual check of every StudiQ feature – from public pages, through the student, teacher and organization-manager dashboards, to plans/payments and the admin panel. Every scenario states its precondition, numbered steps, expected result and the fields used to record the outcome.

Test scale: the document is designed for a small scale – 2-3 records of each type (a few flashcards, a few questions, 1-2 groups, 1-2 quizzes) and a handful of seeded accounts are enough. Plan limits are checked after lowering the values in the database (LIM-02), not by uploading hundreds of records.

### In scope

Registration, login, password reset, role-based route protection (student / teacher / manager).

Student dashboard: flashcard study (SM-2), cramming, quizzes, decks and flashcards, topics, question banks, quizzes, reports, statistics, AI assistant, account.

Teacher dashboard: decks and flashcards, question banks, quiz builder, quizzes (publishing, grading, export, print), groups, reports, statistics.

Manager dashboard: members, invitations, groups, roles and permissions, licences (seats), settings and branding.

Plans, limits, features (feature flags), simulated payment.

Admin panel: feature flags, plans, user overrides, organizations, users (30-day bin), API signature protection.

Negative security and data-isolation tests plus non-functional requirements (language, theme, responsiveness, accessibility, performance).

### Out of scope

Real payment integration (the payment module is deliberately simulated – team decision of 2026-09-14).

AI oral exam (optional feature, not implemented) and "Live" sessions (the "coming soon" screen).

Load tests, large data volumes and penetration tests – this document contains only basic security checks.

Automated tests (unit/integration/e2e) – run them separately with `bun test`.

# 2. Test accounts and data

All seeded accounts use the password `pass`. QA slots run a production build, so there is no "Dev Quick Login" panel; **always sign in with `POST /api/v1/auth/login`** (`{"email","password"}`), never through Dev Quick Login or the form. Mailpit inbox: `http://localhost:$((54321 + 100 * N + 3))` for slot N (env-1 `:54424`, env-2 `:54524`, …). For a local stack-mode project, use the `mail` URL reported by `bun dev:status`.

| E-mail                      | Alias | Account type | Organizations / role                                   | Personal plan | Notes                                                               |
| --------------------------- | ----- | ------------ | ------------------------------------------------------ | ------------- | ------------------------------------------------------------------- |
| manager@dev.local           | M1    | manager      | WSB Merito (admin), UE Wrocław (admin)                 | Launch        | Two organizations – switch test                                     |
| manager2@dev.local          | M2    | manager      | Akademia Górnicza (admin)                              | Launch        | Only organization, no groups or students                            |
| teacher1@dev.local          | T1    | educator     | WSB Merito and UE Wrocław (teacher); groups O1G1, O2G1 | Lite          | Main teacher account                                                |
| teacher2@dev.local          | T2    | educator     | WSB Merito and UE Wrocław (teacher); groups O1G2, O2G2 | Lite          | For isolation tests against T1                                      |
| student1@dev.local          | S1    | student      | WSB Merito (member), group O1G1                        | Base          | Has a personal deck "O1S1"                                          |
| student2@dev.local          | S2    | student      | UE Wrocław (member), group O2G1                        | Base          | Different organization from S1                                      |
| student3@dev.local          | S3    | student      | no organization                                        | Base          | Standalone account (B2C)                                            |
| test-student@dev.local      | TS    | student      | none                                                   | Base          | No content at all – for "from scratch" and limit tests              |
| teacher-classroom@dev.local | TC    | educator     | Classroom (admin), group "Classroom Group"             | Launch        | Full data: 2 banks, 10 questions, 2 decks (8 flashcards), 2 quizzes |
| student-classroom@dev.local | SC    | student      | Classroom (member), group "Classroom Group"            | Base          | TC's student – for quizzes and tests                                |

### Organizations, groups and seeded content

| Organization (plan)        | Members                                   | Groups                   | Content                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WSB Merito (Launch)        | M1 admin; T1, T2 teacher; S1 member (4/5) | O1G1 (T1, S1), O1G2 (T2) | Decks/banks/topics marked O1G1T1, O1G2T2, personal O1S1                                                                                                                                                                                                                                                                            |
| UE Wrocław (Launch)        | M1 admin; T1, T2 teacher; S2 member (4/5) | O2G1 (T1, S2), O2G2 (T2) | O2G1T1, O2G2T2, personal O2S2                                                                                                                                                                                                                                                                                                      |
| Akademia Górnicza (Launch) | M2 admin                                  | —                        | none                                                                                                                                                                                                                                                                                                                               |
| Classroom (Launch)         | TC admin; SC member                       | Classroom Group          | Banks: Historia (4 questions: 2 multiple choice, 1 true/false, 1 open), Geografia i Nauka (6 questions: 2 multiple choice, 2 true/false, 2 open); decks: Historia – flashcards, Geografia – flashcards (4 each); quizzes: "Historia — Średniowiecze", "Geografia i Nauka — Odkrycia"; topics: Średniowiecze, Odkrycia geograficzne |

### Plans (prices are stored in grosze in the database)

| Type         | Free                         | Entry          | Mid                                    | Top                                 |
| ------------ | ---------------------------- | -------------- | -------------------------------------- | ----------------------------------- |
| Student      | Base                         | Spark 9.99 zł  | Ace 19.99 zł (AI, advanced statistics) | Pro 39.99 zł (no limits)            |
| Educator     | Lite (groups 1, students 5)  | Guide 19.99 zł | Creator 39.99 zł (AI)                  | Master 79.99 zł (roles, no limits)  |
| Organization | Launch (groups 3, members 5) | Team 99 zł     | Hub 299 zł (AI, roles, branding)       | Campus 699 zł (no limits, branding) |

# 3. How to use this document

### Result fields ("Result" column)

| Field   | When to select                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| OK      | Every point of the expected result is satisfied.                                                                                   |
| FAIL    | Any point is not satisfied. Describe what happened in the notes and file an issue. Put the issue number in the last column.        |
| BLOCKED | The test could not be run (for example the previous step failed, data is missing, or the environment is missing). Give the reason. |
| N/A     | Not applicable in this configuration (for example no AI key, PR #130 not applied). Give the reason.                                |

The choice fields are clickable controls in the Word document (click to check ☒). On paper, use a pen. Select exactly one field per scenario.

### Priorities

| Priority       | Meaning                                                                    | Execution rule                                           |
| -------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- |
| P1 – critical  | Core functionality or security; a failure blocks the user or exposes data. | Always run first. A P1 failure means an immediate issue. |
| P2 – important | Standard functionality, validations, alternative paths.                    | Run in the full pass.                                    |
| P3 – cosmetic  | Visual, language and rare edge cases.                                      | Run when there is time; collect failures in a batch.     |

### Execution rules

Read the whole scenario before starting. Run the steps exactly in the given order and on the specified account.

Text in quotes "…" means exact UI copy (in Polish). A difference in the message text is a language remark (P3), not a behaviour failure – unless the message is misleading.

The phrase "note it" means the expected behaviour is not unambiguous – write the actual result in the notes and decide with the team whether to pass it.

The markers "KNOWN ISSUE", "ATTENTION", "VERIFY AND REPORT" point to places where a code review suggested a likely defect – confirm it with a test.

After every failure, save a screenshot, the Console errors and the failed request from the Network tab (URL, status, response).

Never use real card data or real passwords – payment is simulated and the test passwords are public.

### Deviations from the document (product decisions)

**PUB-08 — teacher dashboard without a "Class" section** (decision #292, 2026-10-25). The 404 page `/edu/nie-istnieje` shows four links: Overview / Questions / Flashcards / Statistics. The `/edu/classroom` route has no target page (only `/edu/classroom/members`, `/edu/classroom/invite` and `/edu/classroom/new` exist), and member/group management belongs to the manager dashboard – the missing "Class" link is expected, not a defect.

### Suggested order

1. PUB, AUT → 2) ONB → 3) STU → 4) EDU → 5) MGR → 6) BIL, LIM → 7) ADM → 8) SEC → 9) NFR. A full pass makes sense after `bunx supabase db reset`.

# 4. Module index and execution summary

Fill this in after testing (count of selections per module).

| Code | Module                                        | Scenarios | OK  | FAIL | BLOCKED | N/A |
| ---- | --------------------------------------------- | --------- | --- | ---- | ------- | --- |
| PUB  | Public pages and global navigation            | 8         |     |      |         |     |
| AUT  | Authentication and session                    | 19        |     |      |         |     |
| ONB  | Onboarding, organizations and invitations     | 10        |     |      |         |     |
| STU  | Student dashboard (/app)                      | 52        |     |      |         |     |
| EDU  | Teacher dashboard (/edu)                      | 41        |     |      |         |     |
| MGR  | Organization manager dashboard (/manage)      | 28        |     |      |         |     |
| BIL  | Plans, billing and payment (simulated)        | 7         |     |      |         |     |
| LIM  | Features (feature flags) and plan limits      | 7         |     |      |         |     |
| ADM  | Admin panel (apps/admin, port 4000)           | 21        |     |      |         |     |
| SEC  | Authorization and data isolation              | 13        |     |      |         |     |
| NFR  | Non-functional and cross-cutting requirements | 8         |     |      |         |     |
|      | TOTAL                                         | 214       |     |      |         |     |

File issues in the team's tracker (for example GitHub Issues in `logyQT/studiq`). Suggested template:

| Field              | Content                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| Title              | Short: [module] what is broken (e.g. "[MGR] Manager account leads to 404") |
| Scenario number    | e.g. MGR-ACC-01, step 2                                                    |
| Reproduction steps | Numbered list from clean data (after `bunx supabase db reset`)             |
| Expected result    | Copy from the document                                                     |
| Actual result      | What happened, exact message text                                          |
| Attachments        | Screenshot, Console output, failed Network request (URL, status, response) |
| Severity           | Critical (blocks work or exposes data) / High / Medium / Low               |
| Reproducibility    | Always / sometimes (how many times out of how many attempts)               |
