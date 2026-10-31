# Security testing — rules of engagement

This file exists so an agent (or a human) never has to guess whether a security probe is
allowed. If a probe is not covered here, stop and ask; do not improvise against a live target.

## 1. Authorization

The target is **this repository**, run **locally**, by the repository's owner. Testing is
authorized for:

- the web app (`apps/web`, production build started with `next start -p 3010`)
- the admin app (`apps/admin`, built with `bun run build:admin` and started with
  `bun run start:admin`, which runs `next start -p 4000`)
- a **dedicated** Supabase instance started for the test (never the shared QA database)

Testing is **not** authorized, ever, without a new explicit instruction:

- any deployed environment (staging, production, a customer's instance)
- any third-party service (Supabase cloud, Stripe, DiceBear, an IdP)
- any account, tenant or data that is not seeded by the test itself
- denial of service, stress/load runs, or anything that degrades the shared box
- social engineering, phishing, credential stuffing against real accounts

If a probe would touch something outside this list, **stop and report it as a question**, not
as an action.

## 2. Environment

1. **Production build, dedicated stack.** Build both apps from the repo root with
   `bun run build` (web) and `bun run build:admin` (admin), then start them with
   `cd apps/web && bunx next start -p 3010` and `bun run start:admin` (`next start -p 4000`
   in `apps/admin`). `next dev` behaves differently (middleware, source maps, error
   surfaces) and findings do not transfer.
2. **Own Supabase.** `bunx supabase start` for the run; seed with
   `bun scripts/qa-tenant.ts SEC-02 --profile two-org --fresh`. Never point probes at
   `:54421` (the shared QA database) — a mass IDOR scan would write noise into other
   people's tenants.
3. **Seed your own tenants.** The `two-org` profile creates one manager who is admin of
   both organizations: org A has that manager plus a teacher and a student, org B has the
   manager plus a student, and each org has two groups and one pending invitation. It writes
   the ids and credentials to `qa/.tenants/SEC-02.json`. Create decks, cards, banks,
   questions and quizzes through the app as those users. Cross-tenant probes need a
   _foreign_ id, so you must create one deliberately.
4. Throw the stack away afterwards. Findings are the artifact, not the environment.

## 3. Technique boundaries

Allowed: reading the code, calling the app's own HTTP API as a seeded user, replaying/tampering
requests, changing ids and body fields, testing authorization boundaries, inspecting cookies and
storage, direct PostgREST calls with the **public anon key** and a seeded user's JWT.

Not allowed: modifying the database out-of-band to "prove" a point, disabling RLS to show what
would happen, using the service-role key to produce a finding (that key is not reachable by an
attacker, so it proves nothing), or writing to another tenant.

## 4. Evidence standard

Every finding carries:

- **expected vs actual**, with the control that should have stopped it;
- the exact request (method, path, headers that matter, body) and the response (status, body);
- the **two tenant keys** involved when it is cross-tenant;
- a screenshot of the user-visible effect, uploaded with `--attach` (never a local path);
- severity, and whether an unprivileged user or an anonymous visitor can trigger it.

## 5. Severity

| level        | meaning                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **critical** | cross-tenant read/write, privilege escalation, auth bypass without credentials, plan/entitlement forgery                    |
| **high**     | any authenticated user reaching another user's data within an org they are not in; admin surface reachable from the web app |
| **medium**   | missing rate limit on a guessing surface, information disclosure (ids, emails, internal errors), weak file validation       |
| **low**      | hardening, headers, verbose errors with no data, UX-security mismatch                                                       |

## 6. Reporting

- One issue per finding, labelled `security` + severity, title `[SECURITY] <area>: <control that failed>`.
- Deduplicate first: search open **and** closed issues for the case/route before filing.
- Do **not** paste real customer data, tokens or keys into an issue; reference ids only.
- Do **not** open a PR with a working exploit.

## 7. Turning a finding into a regression test

Only **after** the fix lands: add a QA spec that asserts the _deny_ — the request answers
403/404, the other tenant's row is absent, the tampered field is ignored. The committed test
must contain no payload that is useful against a live system. This mirrors the QA rule "assert
intended behaviour, never encode the bug".

## 8. Stop conditions

Stop and report immediately, without escalating further, if a probe:

- returns another tenant's **real** data (not your seeded fixture);
- succeeds without any credential;
- would require deleting or corrupting data to confirm;
- hits something that looks like a live secret (key, token, connection string).
