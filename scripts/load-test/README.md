# Load test — bots + account seeder

Generate realistic API traffic against a running StudiQ instance so you can
exercise (and watch) the observability stack: Prometheus metrics, Tempo traces,
Loki logs and the `x-trace-id` correlation loop described in
[`docs/observability-debugging.md`](../../docs/observability-debugging.md).

Two independent scripts:

| Script    | Purpose                                                                 |
| --------- | ----------------------------------------------------------------------- |
| `seed.ts` | Create a large pool of confirmed accounts via the Supabase Admin API    |
| `bots.ts` | Log in as those accounts and drive concurrent, randomized user journeys |

Both run directly with Bun (no build step) and are dependency-free.

---

## 1. Prerequisites

- Local Supabase running (`supabase start`) and a working app:
  - app on `http://localhost:3000` (or pass `--app-url`), and
  - telemetry pointed at the OTel Collector — i.e. the app was started with
    `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` and `OTEL_SDK_DISABLED`
    **not** `true`.
- Connection settings are read from the environment (Bun auto-loads `.env` /
  `.env.local`) with local defaults:

  | Variable                    | Default                  |
  | --------------------------- | ------------------------ |
  | `SUPABASE_URL`              | `http://127.0.0.1:54321` |
  | `SUPABASE_ANON_KEY`         | local anon JWT           |
  | `SUPABASE_SERVICE_ROLE_KEY` | local service-role JWT   |
  | `APP_URL`                   | `http://localhost:3000`  |
  | `LOADTEST_DIR`              | `.dev/load-test`         |
  | `LOADTEST_PASSWORD`         | `Password123!`           |
  | `LOADTEST_EMAIL_DOMAIN`     | `loadtest.studiq.local`  |

> `.dev/` is git-ignored, so generated pools and reports never get committed.

### Auth rate limits (important)

Supabase Auth rate-limits sign-in to **30 per 5 minutes per IP** by default
(`[auth.rate_limit] sign_in_sign_ups` in `supabase/config.toml`). Logging in 50
bots from one machine at once will trip it. Either:

- let `bots.ts` handle it — it retries `429`s with backoff and reports how many
  logins failed; or
- raise the limit for the duration of your test and restart Supabase:

  ```toml
  # supabase/config.toml
  [auth.rate_limit]
  sign_in_sign_ups = 3000
  ```

  ```bash
  supabase stop && supabase start
  ```

Sessions are cookie-based and auto-refresh on each request, so bots log in once
per run and then keep their session alive without re-authenticating.

---

## 2. Seed the account pool

```bash
# 1000 accounts: ~850 students, ~100 educators, ~50 managers
bun scripts/load-test/seed.ts --count 1000
```

| Flag                   | Default                 | Description                      |
| ---------------------- | ----------------------- | -------------------------------- |
| `--count <n>`          | `1000`                  | number of accounts               |
| `--concurrency <n>`    | `20`                    | parallel Admin API requests      |
| `--students <0-1>`     | `0.85`                  | student ratio                    |
| `--educators <0-1>`    | `0.10`                  | educator ratio                   |
| `--managers <0-1>`     | `0.05`                  | manager ratio                    |
| `--password <pw>`      | `Password123!`          | shared password                  |
| `--domain <domain>`    | `loadtest.studiq.local` | email domain                     |
| `--supabase-url <url>` | env                     | Supabase API URL                 |
| `--dry-run`            | –                       | print the plan, create nothing   |
| `--reset`              | –                       | delete every account in the pool |

- **Idempotent** — re-running skips accounts that already exist.
- Accounts are created with `email_confirm: true`, so they can log in
  immediately even though local GoTrue has `enable_confirmations = true`.
- The `handle_new_user` DB trigger creates the matching `profiles` row and
  stamps `app_metadata.account_type`, exactly like a real signup.
- The pool is written to `.dev/load-test/accounts.json` for `bots.ts`.

Reset the pool when you're done:

```bash
bun scripts/load-test/seed.ts --reset
```

### Convenience scripts

```bash
bun run loadtest:seed       # seed.ts --count 1000
bun run loadtest:bots       # bots.ts --users 50 --duration 300
bun run loadtest:reset      # seed.ts --reset
```

---

## 3. Drive traffic

```bash
# 50 concurrent users for 5 minutes
bun scripts/load-test/bots.ts --users 50 --duration 300

# quick smoke test
bun scripts/load-test/bots.ts --users 5 --duration 30

# students only, snappier
bun scripts/load-test/bots.ts --users 50 --student-bots 1 --think-min 50 --think-max 200
```

| Flag                      | Default                        | Description                       |
| ------------------------- | ------------------------------ | --------------------------------- |
| `--users <n>`             | `50`                           | concurrent bots                   |
| `--duration <s>`          | `300`                          | run length in seconds             |
| `--student-bots <0-1>`    | `0.85`                         | share of bots that are students   |
| `--think-min <ms>`        | `200`                          | min think time between actions    |
| `--think-max <ms>`        | `1500`                         | max think time between actions    |
| `--login-concurrency <n>` | `5`                            | parallel logins during onboarding |
| `--seed <n>`              | `42`                           | RNG seed (reproducible runs)      |
| `--accounts <file>`       | `.dev/load-test/accounts.json` | account pool                      |
| `--app-url <url>`         | env                            | app base URL                      |

### What the bots do

Each bot logs in through `POST /api/v1/auth/login` (capturing the Supabase
session cookies), then loops a **weighted** journey until the duration expires.
Reads dominate — writes are sprinkled in so the DB sees real mutations.

**Students** (85% of bots) mostly:

- `GET /api/v1/flashcards/decks`, `/topics`, `/flashcards`, deck/flashcard detail
- practice flow — `due/count`, `states`, `cards-stats`, `prepare`, `review`
- `POST /api/v1/flashcards/{id}/practice` (log a review) and
  `POST /api/v1/flashcards/batch/create`
- `GET /api/v1/stats/student`, `/stats/weak-points`, `/stats/activity`
- `GET /api/v1/quiz/attempts`, `/search`, plus auth/feature/permission calls
- occasional `POST /api/v1/flashcards/decks` and `POST /api/v1/quiz/new`
  (the latter returns `404` on a fresh account → useful realistic errors)

**Educators / managers** scan their dashboards instead: `/stats/teacher*`,
`/teacher/quizzes`, `/teacher/assignments`, `/questions`, `/questions/banks`,
`/organization*`, `/subscription-plans`, etc.

Each bot remembers the deck/topic/card ids it discovers, so follow-up actions
reference real resources.

### Reading the report

`bots.ts` prints, at the end:

- wall time, requests, req/s, error rate, p50/p95/p99 latency
- how many responses carried **`x-trace-id`**
- a status-code histogram and a per-action breakdown (volume, avg latency, errors)
- **recent failing trace ids** — paste one into Grafana → Explore → Tempo to see
  the exact request, then jump to its Loki logs.

---

## 4. Watching it in the observability stack

With the stack up (`docker compose up -d`) and the app exporting to the
collector:

- **Grafana → StudiQ — OpenTelemetry Overview** (`http://localhost:3001`): watch
  request rate, p95/p99, error rate and active requests move as the bots run.
- **Prometheus** (`:9090`): `rate(studiq_http_server_request_total[1m])`,
  `studiq_controller_method_duration_milliseconds_bucket`.
- **Tempo** (Grafana → Explore → Tempo): search by the `x-trace-id` from a
  failing request.
- **Loki** (Grafana → Explore → Loki): the same trace's logs via the `trace_id`
  derived field.

## 5. Suggested ramp

| Stage | Command                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------- |
| smoke | `bots.ts --users 5 --duration 30`                                                                    |
| warm  | `bots.ts --users 25 --duration 120`                                                                  |
| load  | `bots.ts --users 50 --duration 300`                                                                  |
| soak  | `bots.ts --users 50 --duration 1800`                                                                 |
| spike | raise `--users` and lower `--think-min/--think-max`, e.g. `--users 150 --think-min 0 --think-max 50` |

> Tip: keep `--seed` fixed to compare runs, and vary `--think-*` to change the
> request rate without changing the user count.
