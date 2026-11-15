# Security testing — rules of engagement

This file exists so an agent (or a human) never has to guess whether a security probe is
allowed. If a probe is not covered here, stop and ask; do not improvise against a live target.

## 1. Authorization

The target is **this repository**, run **locally**, by the repository's owner. Testing is
authorized for:

- the web app (`apps/web`, production build started with `next start -p 3020` — **not**
  `:3010`, which the shared QA app owns)
- a **dedicated** Supabase instance started for the test (never the shared QA database)

`apps/admin` is **out of scope** for QA and security probes: it is an internal
tool with no app-level auth, protected only at the deployment edge. Do not start
it, sign requests for it, or probe it.

Testing is **not** authorized, ever, without a new explicit instruction:

- any deployed environment (staging, production, a customer's instance)
- any third-party service (Supabase cloud, Stripe, DiceBear, an IdP)
- any account, tenant or data that is not seeded by the test itself
- denial of service, stress/load runs, or anything that degrades the shared box
- social engineering, phishing, credential stuffing against real accounts

If a probe would touch something outside this list, **stop and report it as a question**, not
as an action.

## 2. Environment

1. **Own Supabase first.** If this checkout already has a stack running, restart it through the
   stack contract: `bun run env:down --all --yes` (never `supabase stop --all`, which stops every
   stack on the machine), then `bun run env:ensure --profile api` — database + REST, which the
   PostgREST probes need (`--profile db` has no REST; add `--profile web` when the step needs a
   built and served app). Before seeding, read the endpoints
   from `bunx supabase status --output-format json` (`API_URL`, `DB_URL`) rather than
   assuming the default `:54321` — stack mode assigns ports per checkout. When
   `SUPABASE_STACK` names a non-default stack, add `--stack "$SUPABASE_STACK"`: a bare
   status reports the branch's default stack, so the probes would target the wrong DB.
   `NEXT_PUBLIC_SUPABASE_URL` must be that `API_URL` and `SUPABASE_DB_URL` (when set)
   must be that `DB_URL`; `qa/env.json` overrides the environment, so a QA worktree
   silently points at the shared `:54421`.
2. **Point the app and the seeder at that stack before building.** `NEXT_PUBLIC_*`
   values are baked in at build time, and the seeder reads root `.env.local`
   (with `qa/env.json` overriding the URL) as its input. Set
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for `apps/web`
   and the seeder, and verify each one resolves to your dedicated stack. If the app
   still targets shared QA, seeded users cannot authenticate against the app's
   database and probes hit the wrong database.
3. **Production build, dedicated stack.** Build the app from the repo root with
   `bun run build`, then start it with
   `cd apps/web && bunx next start -p 3020`. `next dev` behaves differently
   (middleware, source maps, error surfaces) and findings do not transfer.
4. **Seed your own tenants.** Seed with
   `bun scripts/qa-tenant.ts SEC-02 --profile two-org --fresh --dedicated`; `--dedicated`
   checks both writers (REST and `SUPABASE_DB_URL`) and refuses any non-local endpoint or
   the shared QA ports (`:54421`/`:54422`). Never point probes at `:54421`
   (the shared QA database) — a mass IDOR scan would write noise into other people's
   tenants. The `two-org` profile creates one manager who is admin of
   both organizations: org A has that manager plus a teacher and a student, org B has the
   manager plus a student, and each org has two groups and one pending invitation. It writes
   the ids and credentials to `qa/.tenants/SEC-02.json`. Create decks, cards, banks,
   questions and quizzes through the app as those users. Cross-tenant probes need a
   _foreign_ id, so you must create one deliberately.
5. Throw the stack away afterwards. Findings are the artifact, not the environment.

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
the probe's own expected denial status (`401` for a missing session, `403`/`404` for a
foreign object), the other tenant's row is absent, the tampered field is ignored. The
committed test must contain no payload that is useful against a live system. This mirrors
the QA rule "assert intended behaviour, never encode the bug".

## 8. Stop conditions

Stop and report immediately, without escalating further, if a probe:

- returns another tenant's **real** data (not your seeded fixture);
- succeeds without any credential;
- would require deleting or corrupting data to confirm;
- hits something that looks like a live secret (key, token, connection string).
