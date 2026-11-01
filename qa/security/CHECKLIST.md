# Security checklist — first pass

The probes worth running before anything more exotic. Each row states the **expected deny**, so a
pass is a "no", and anything that answers "yes" is a finding. Scope and ethics: [ROE.md](ROE.md).

Run against a **dedicated** stack, production build, seeded tenants (two orgs).

## A. Authentication surface

| #   | probe                                                                                                                                                                                      | expected                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| A1  | Every file under `apps/web/src/app/(backend)/api/**/route.ts` calls `withAuth`, except the documented public set (`auth/*`, `avatar/*`, `health`, `subscription-plans*`, `stripe/webhook`) | no other route is reachable without a session      |
| A2  | `GET /api/v1/<any protected route>` with no cookie                                                                                                                                         | `401`, never data                                  |
| A3  | `GET /api/v1/auth/me` with no cookie                                                                                                                                                       | `200` with a null user and **no** profile/org data |
| A4  | A route that took the session but reads ids from the body/query (`?userId=`, `?orgId=`) honours the caller's own scope                                                                     | foreign ids are `403`/`404`                        |

Known baseline: 126 web API routes, 12 without `withAuth` — all in the public set above. Re-run
the grep after any route change; a new one outside that set is a finding on its own.

## B. Object-level authorization (the main event)

| #   | probe                                                                                                       | expected                                         |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| B1  | Read a deck / card / bank / question / quiz / group that belongs to **org B** as a user of **org A**, by id | `403` or `404`                                   |
| B2  | `PATCH` / `DELETE` the same foreign ids                                                                     | `403`/`404`, and the row is unchanged afterwards |
| B3  | List endpoints with `?organizationId=<org B>` or `?groupIds=<G of B>`                                       | filtered to the caller's scope, or `403`         |
| B4  | Personal (non-group) content of another user in the same org                                                | `403`/`404`                                      |
| B5  | Invite/join ids: accept an invitation addressed to another address                                          | `4xx`, no membership created                     |

## C. Mass assignment / trust of client fields

| #   | probe                                                                                                                                             | expected                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| C1  | Create or update a resource with extra fields (`account_type`, `organization_id`, `created_by`, `plan`, `visibility` where not a feature, `role`) | unknown fields ignored or `422`; protected fields never taken from the body |
| C2  | Register with `account_type: manager` (or `educator`) in the body                                                                                 | the account gets the default type, not the requested one                    |
| C3  | Any endpoint that echoes back the row it just wrote                                                                                               | no field the caller did not ask for changed                                 |

`account_type` is the escalation to watch: `withAuth` reads it from the token, so a writable
`account_type` is a role switch, not a profile edit.

## D. Invites, join codes, session codes

| #   | probe                                                      | expected                                           |
| --- | ---------------------------------------------------------- | -------------------------------------------------- |
| D1  | Re-use an invitation token after it was accepted           | `4xx`, no second membership                        |
| D2  | Use an expired or revoked token                            | `4xx`                                              |
| D3  | Accept an invite for org A while already a member of org B | joins A only; no cross-org role                    |
| D4  | Choose your own role when accepting                        | role comes from the invitation, not the request    |
| D5  | Guess a join code / session code (N attempts)              | rate limited (`429`) or rejected without an oracle |

## E. Session and transport

| #   | probe                                                            | expected                                                                                    |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| E1  | Inspect cookies                                                  | `HttpOnly`, `Secure` in production, `SameSite`; no token in `localStorage`/`sessionStorage` |
| E2  | Log out, replay the old cookie                                   | `401`                                                                                       |
| E3  | State-changing request with a foreign `Origin` and no CSRF token | rejected                                                                                    |
| E4  | Response headers                                                 | no `x-powered-by`, sane CSP/frame options on the app shell                                  |

## F. Payments and entitlements

| #   | probe                                                                         | expected                                                                                          |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| F1  | `POST /api/v1/stripe/webhook` with no session                                 | `401` (today it is `withAuth`-gated; a real Stripe integration must instead verify the signature) |
| F2  | With a session, a webhook body naming **another** org or plan                 | the caller's own plan only; no foreign org changed                                                |
| F3  | Buy/grant a plan without going through checkout (mock or direct RPC)          | not reachable without the checkout path                                                           |
| F4  | Downgrade/upgrade leaves limits consistent (`/api/v1/me/plan`, feature flags) | snapshot updated, no stale entitlement                                                            |

## G. Files and public buckets

| #   | probe                                                                                                                     | expected                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Upload a file whose MIME type is outside the allowlist (e.g. `text/html`), an oversized file, and a double-extension file | rejected by declared type, sniffed content and size, not just by extension; valid audio (`audio/mpeg`, `audio/wav`, `audio/ogg`) is allowed |
| G2  | Fetch an object from a public bucket that belongs to another org                                                          | public read is a **declared** exposure (`flashcard-media`, org logos) — verify it contains no personal data                                 |
| G3  | Path traversal in any file path parameter                                                                                 | `4xx`                                                                                                                                       |

## H. Rate limiting and enumeration

| #   | probe                                 | expected                                          |
| --- | ------------------------------------- | ------------------------------------------------- |
| H1  | Repeated failed logins                | `429` after a threshold, no user-existence oracle |
| H2  | Password reset for an unknown address | same response as for a known one                  |
| H3  | Invite-code / join-code brute force   | throttled                                         |

## I. Admin app

| #   | probe                                                                   | expected                                                                                               |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| I1  | `/api/*` on `:4000` with no signature and a **non-empty** keyring       | `401`                                                                                                  |
| I2  | `/api/*` in a production build with an **empty** keyring                | `401` (fail closed)                                                                                    |
| I3  | A signed key with scope `feature-flags:read` calling an org/users route | `403`                                                                                                  |
| I4  | Every id-taking admin route                                             | no reach beyond the route's own scope (see ADR-0007 admin API auth for the target authorization model) |

## J. Direct database surface (PostgREST)

The anon key ships in the browser, so this is a real attack surface, not a theoretical one.

| #   | probe                                                                      | expected                                                               |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| J1  | `GET /rest/v1/<table>` with only the anon key, for every table in `public` | no rows (or only deliberately public reference data)                   |
| J2  | Same with a seeded user's JWT, on the tenant tables                        | only that user's tenant rows                                           |
| J3  | Same user, `organization_id=eq.<org B>`                                    | empty, not an error that leaks existence                               |
| J4  | `security definer` functions                                               | `search_path` set, caller role checked, no cross-tenant read           |
| J5  | Storage buckets                                                            | public ones contain no personal data; private ones refuse the anon key |

## Order of work

1. **J** first — it is mechanical, scriptable, and the blast radius if RLS is missing dwarfs
   everything else.
2. **A + B** — route allowlist and cross-tenant object access; this is where app-level findings
   usually are.
3. **C + D** — mass assignment and invite flows.
4. **E + F + G + H** — hardening, unless something in 1–3 already looks wrong.
5. **I** — admin, following the scoped-key model in ADR-0007 (admin API auth); before the DB-backed grants land, the gate is the whole story.
