# Onboarding Guide

This guide walks new team members through setting up the local development environment.

---

## Prerequisites

- **Docker Desktop** — must be installed and running before any steps
  [Download Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Node.js 20+** — runtime for the Next.js application
- **Bun** — package manager and runtime
  ```bash
  # Install bun (if not already installed)
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```
- **Git** — version control ([Git for Noobs](./GIT-FOR-NOOBS.md))
- **GitHub CLI (`gh`)** — required for agents to push branches, create PRs, and manage worktrees
  ([Install `gh`](https://cli.github.com/))

---

## GitHub CLI Setup (`gh`)

The project scripts (`scripts/pr`, `scripts/spin`) rely on the GitHub CLI for branch
management and PR creation. Both human developers and AI agents need a working `gh`
installation with the right permissions.

### 1. Install GitHub CLI

```bash
# macOS
brew install gh

# Windows (winget)
winget install GitHub.cli

# Linux (Debian/Ubuntu)
sudo apt install gh

# Linux (Fedora)
sudo dnf install gh

# Or via the official installer
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh
```

### 2. Authenticate with GitHub

Run the interactive login flow:

```bash
gh auth login
```

When prompted:

| Prompt                 | Recommended answer                                        |
| ---------------------- | --------------------------------------------------------- |
| **GitHub account**     | Pick the account that has access to this repo             |
| **Preferred protocol** | `HTTPS` (simpler) or `SSH` (if you already have SSH keys) |
| **Authenticate?**      | `Yes` — opens a browser for OAuth, or paste a token       |

For **headless / CI / agent environments** (no browser available), use a personal access token:

1. Go to <https://github.com/settings/tokens> → **Generate new token (classic)**
2. Select these scopes (see below for details)
3. Paste the token when prompted:

```bash
gh auth login --with-token <<< "ghp_your_token_here"
```

### 3. Required token permissions (scopes)

When creating a PAT for agents or CI, enable these scopes:

| Scope          | Why                                                                  |
| -------------- | -------------------------------------------------------------------- |
| **`repo`**     | Full control of private repos — push branches, create PRs, read code |
| **`read:org`** | Needed if the repo belongs to a GitHub organization                  |
| **`workflow`** | Optional — only if agents need to trigger or manage GitHub Actions   |

For fine-grained tokens, grant repository access to **this specific repo** with
**Contents** (read/write), **Pull requests** (read/write), and **Metadata** (read)
permissions.

> **Minimum for agents:** A classic PAT with `repo` scope, or a fine-grained token
> with Contents + Pull requests permissions on the StudiQ repository.

### 4. Verify everything works

```bash
# Check auth status
gh auth status

# Test: list open PRs
gh pr list

# Test: view repo info
gh repo view
```

All three commands should succeed without errors.

### 5. How agents use `gh`

The project ships helper scripts that wrap `gh` for common workflows:

#### Creating a worktree (isolated branch + directory)

```bash
scripts/spin feat/my-feature
```

This creates a new git worktree beside the repo (grouped by branch prefix)
with its own branch off `main`. Move your agent session into it:

```bash
cd ../studiq-worktrees/feat/my-feature
```

#### Committing and pushing

```bash
git add -A
git commit -m "feat: add new feature"
git push -u origin feat/my-feature
```

The `scripts/pr` script will auto-push the branch if it hasn't been pushed yet.

#### Creating a pull request

```bash
scripts/pr                          # auto-generate title from commits
scripts/pr "fix: resolve login bug" # custom title
scripts/pr --draft                  # create as draft
scripts/pr --list                   # list open PRs
scripts/pr --view                   # open PR in browser
```

#### Full agent workflow (start to finish)

```bash
# 1. Spin up an isolated workspace
scripts/spin feat/my-feature

# 2. Move into the worktree
cd ../studiq-worktrees/feat/my-feature

# 3. Install dependencies (first time in a new worktree)
bun install

# 4. Make changes, then commit and push
git add -A && git commit -m "feat: my changes"
git push -u origin feat/my-feature

# 5. Create a PR
scripts/pr

# 6. Clean up after merge
scripts/spin feat/my-feature --clean
```

#### Listing and cleaning up worktrees

```bash
scripts/spin --list                 # see all active worktrees
scripts/spin feat/my-feature --clean  # remove worktree + delete branch
```

Worktrees are created beside the repo as `../<repo>-worktrees/<branch>`, so the
branch hierarchy stays visible (`feat/my-feature` →
`../studiq-worktrees/feat/my-feature`). `--clean` only removes worktrees that
`scripts/spin` created.

### 6. Troubleshooting

#### `gh: command not found`

`gh` is not installed or not on your `PATH`. Follow the install steps above and
restart your terminal (or `source ~/.bashrc` / `source ~/.zshrc`).

#### `gh: not logged in`

Run `gh auth login` and follow the prompts. For headless environments, use the
`--with-token` flag with a PAT.

#### `Permission denied (publickey)` when pushing

If using the SSH protocol, ensure your SSH key is added to the SSH agent and
registered in your GitHub account settings. Switch to HTTPS if you don't have SSH
keys set up.

#### `gh pr create` fails with "could not determine base repository"

Make sure you are inside the git repository (or a worktree). The `scripts/pr` script
runs `git rev-parse --show-toplevel` to find the repo root.

#### Agent cannot push to a fork

If the agent is working from a fork, ensure the PAT belongs to the fork owner's
account and has write access to the fork. Alternatively, push from a branch in the
upstream repo if the agent has write access there.

#### Token expired or revoked

Generate a new PAT at <https://github.com/settings/tokens> and re-authenticate:

```bash
gh auth login --with-token <<< "ghp_new_token_here"
```

#### `bun run format:check` reports hundreds of files on Windows

Windows Git installs often default to `core.autocrlf=true`, which rewrites every
checked-out text file to CRLF. The repo pins LF in `.gitattributes`, so fresh clones are
fine; an older clone needs a one-time re-checkout. **Commit or push your work first** —
this rewrites the working tree:

```bash
git rm --cached -r . --quiet
git reset --hard
```

(`bun run format` + `git add --renormalize .` also clears the formatter failures without
discarding work, but leaves Markdown/SQL/etc. as CRLF until the next checkout.)

---

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Configure the checkout

```bash
touch .env.local        # optional for a single checkout — values are derived
```

Root `.env.local` is the only hand-edited values file (Git-ignored; never
commit it). Its keys and their shapes are documented — value-free — in
[`.env.schema`](../.env.schema); `varlock` validates/injects them for the
`bun run …` scripts. Every value is optional: local mode uses the experimental
`supabase stack` backend, which assigns ports and keeps a separate database per
**project root + git branch + optional `SUPABASE_STACK` name**. Only `APP_PORT`
can collide between checkouts — set a different one per worktree
(`bun dev:ports` prints a free port).

### 3. Start the stack

```bash
bun dev:up
```

> First run may take several minutes while Docker pulls images.

`dev:up` starts (or resumes) **this branch's** Supabase stack, discovers its
URLs/keys with `supabase status --output-format json`, **exports** them to the
web process, and starts the web server on `APP_PORT`. It never writes a per-app
env file, installs, builds or resets anything.

Agents (and anyone running several checkouts) should use the production server
instead of `next dev`:

```bash
bun dev:build && bun dev:serve   # or: bun dev:up --prod
```

### 4. Where values live

There is no generated env file to edit. `.env.local` (plus the process
environment, which wins) is the input; `scripts/dev` resolves the contract and
exports it to its children. If you put a key in `.env.local`, it is never
overwritten.

If you need the stack's raw URLs/keys (e.g. shared mode, or a tool that does not
go through `scripts/dev`):

```bash
bash scripts/dev supa status            # human-readable endpoints + service state
bash scripts/dev supa status --env      # exportable KEY=VALUE (APP_URL exported)
```

For a named stack, set `SUPABASE_STACK` (e.g. `export SUPABASE_STACK=test`) and
add `--stack "$SUPABASE_STACK"` to `status`, `start`, `stop`, `logs` and
`bunx supabase stack destroy`. Database commands do not accept `--stack`; use the
`DB_URL` + `--remote` form shown in the team workflow above.

Studio, Mailpit and API URLs are assigned per stack; `bun dev:status` prints the
authoritative ones for this branch.

Optional local e-mail delivery uses the Mailpit container (URL from
`bun dev:status`). Without an SMTP adapter the copyable invite link is the only
delivery path.

OpenTelemetry: telemetry is **on** by default. Add `OTEL_SDK_DISABLED=true` to
`.env.local` to keep traces/metrics/logs off (tests and CI set it); remove the
line to ship to the local collector (`docker compose up -d`).

### 5. (Optional) Set up LLM / AI Provider

For AI-powered flashcard generation, add to `.env.local`:

```env
# Option A: OpenAI
LLM_PROVIDER=openai
LLM_API_KEY=sk-your-openai-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL_NAME=gpt-4o-mini

# Option B: Local Ollama (free, open-source)
# LLM_PROVIDER=ollama
# LLM_BASE_URL=http://localhost:11434/v1
# LLM_MODEL_NAME=llama3.2
```

> The `/v1` suffix is required — `src/server/ai/model.ts` talks to the provider
> through `createOpenAICompatible`, which expects an OpenAI-compatible base URL.
> Without it, requests fail.

To use Ollama, install it from [ollama.com](https://ollama.com) and pull a model:

```bash
ollama pull llama3.2
```

For better (if slower) Polish-language answers on capable hardware, a larger
model such as `qwen2.5:14b` also works well — just point `LLM_MODEL_NAME` at
whatever you've pulled.

### 6. Seed the database (optional)

```bash
bun dev:reset-db
```

> `db reset` **deletes all local data** for **this checkout's** project and
> reloads seed data. Use intentionally. It refuses to run in shared mode and
> never touches another checkout's stack.

### 7. Install Playwright browsers (for E2E tests)

```bash
bunx playwright install chromium
```

### 8. Start the development server

`bun dev:up` already started it. Use `bun dev` only for a local manual dev
server; parallel agents should use `bun dev:build && bun dev:serve` (or
`bun dev:up --prod`) to avoid several `next dev` processes competing for RAM.

### 9. Start the local observability stack (recommended)

```bash
docker compose up -d
```

This runs the **OTel Collector + Tempo (traces) + Loki (logs) + Prometheus
(metrics) + Grafana** and is what `apps/web/src/instrumentation.ts` ships to by
default (OTLP on `:4318`). No app env changes are needed — just don't set
`OTEL_SDK_DISABLED=true`.

| UI                          | URL                   |
| --------------------------- | --------------------- |
| Grafana (`admin` / `admin`) | http://localhost:3001 |
| Prometheus                  | http://localhost:9090 |
| Loki                        | http://localhost:3100 |
| Tempo                       | http://localhost:3200 |
| OTLP intake                 | http://localhost:4318 |

To debug a failing API call end-to-end (browser → `x-trace-id` → Tempo trace →
Loki logs → Prometheus), see [observability-debugging.md](./observability-debugging.md).
Stop the stack with `docker compose down`.

> The services use `restart: unless-stopped`, so they come back **automatically**
> after a container/VM restart (unless you explicitly `docker compose stop`/`down`
> them).

---

## Stop Local Supabase

```bash
bun dev:down --all
```

> Stops only **this branch's** Supabase stack and keeps its data. It refuses
> when `SUPABASE_SHARED=1` and never touches another checkout's stack. Do not use
> `supabase stop --all` on a shared machine. To deliberately wipe this branch's
> database, use `bun dev:reset-db`; `bunx supabase stack destroy` (add
> `--stack "$SUPABASE_STACK"` for a named stack) also deletes the project (including data).

---

## Team Collaboration

Local data is **not synced via git** — each team member has their own local database. Migrations and seeds keep everyone in sync.

### Schema changes

After modifying tables in Supabase Studio, generate a migration:

```bash
# Default stack; for a named stack use the selected-stack conditional in the
# Author workflow below.
bunx supabase db diff -f migration_name
```

Supabase compares the current database state with the last migration and writes the diff to `supabase/migrations/`. **Commit this file to git.**

### Seed data

Edit files in `supabase/seeds/` to manage test data. These files are committed to git.

### Author workflow

```bash
# 1. Make changes in Studio (see `bun dev:status` for the current URL)
# 2. Generate migration from the selected stack (default or SUPABASE_STACK)
STACK=${SUPABASE_STACK:-$(sed -n 's/^SUPABASE_STACK=\([^#[:space:]]*\).*/\1/p' .env.local 2>/dev/null | tail -n1 | tr -d "'\"")}
if [ -n "$STACK" ]; then
  DB_URL=$(bash scripts/dev supa status --stack "$STACK" --env | sed -n "s/^DB_URL='\\(.*\\)'$/\\1/p")
  bunx supabase db diff -f migration_name --remote="$DB_URL"
else
  bunx supabase db diff -f migration_name
fi
# 3. Update seeds if needed
# 4. Commit and push
git add supabase/
git commit -m "migration: migration_name"
```

### Team member workflow

```bash
git pull
bun dev:up                      # this branch's Supabase stack (+ web); does NOT migrate a running stack

# Apply new migrations to the selected stack (default or SUPABASE_STACK)
STACK=${SUPABASE_STACK:-$(sed -n 's/^SUPABASE_STACK=\([^#[:space:]]*\).*/\1/p' .env.local 2>/dev/null | tail -n1 | tr -d "'\"")}
if [ -n "$STACK" ]; then
  DB_URL=$(bash scripts/dev supa status --stack "$STACK" --env | sed -n "s/^DB_URL='\\(.*\\)'$/\\1/p")
  bunx supabase db push --remote="$DB_URL" --yes
else
  bunx supabase db push
fi

bun dev:reset-db                # (optional) reloads fresh seed data, this branch only
```

Every worktree/branch gets its own stack and database automatically. If another
developer/agent already runs the app on the same `APP_PORT`, change it in this
checkout's `.env.local` (`bun dev:ports` prints a free port). Never run
`supabase stop --all`; `bun dev:down --all` only stops this branch's stack.

### Code review (CodeRabbit)

`.coderabbit.yaml` runs `reviews.profile: 'assertive'` and reviews incrementally
by default (`auto_incremental_review`), so each push only re-checks the changed
hunks and deeper findings can arrive one at a time. Request a full pass over the
whole PR with:

```text
@coderabbitai full review
```

`@coderabbitai review` is incremental; `@coderabbitai full review` ignores
earlier comments and reviews the entire diff.

To catch findings before pushing, run a local CLI review (requires the
[CodeRabbit CLI](https://docs.coderabbit.ai/cli) and `coderabbit auth login`):

```bash
coderabbit review --agent                  # tracked changes
coderabbit review --agent --base main      # whole branch against main
```

Guard scripts under `scripts/check-*.ts` have a dedicated checklist in
`.coderabbit.yaml` (errno handling, tracked-but-absent inputs, `--staged` parity,
exit codes) so a full pass reports all error-handling issues together.

---

## Useful Commands

| Command                              | Description                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `bun dev:up`                         | Start this checkout's stack + web server                                         |
| `bun dev:up --prod`                  | Production build (if missing) + `next start`                                     |
| `bun dev:serve`                      | `next start` on `APP_PORT` (no dev server)                                       |
| `bun dev:status`                     | Health, stack id/endpoints (`--json`)                                            |
| `bun dev:down [--all]`               | Stop this checkout's web (+ this stack with `--all`)                             |
| `bun dev:reset-db`                   | Reset this branch's DB + load seeds                                              |
| `bun dev:doctor`                     | Explain missing / owned / colliding state                                        |
| `bun dev:ports`                      | Print a free `APP_PORT` (stack ports are dynamic)                                |
| `bunx supabase status`               | This stack's URLs, keys and service state                                        |
| `bunx supabase db diff -f <name>`    | Generate migration from current changes                                          |
| `bunx supabase migration new <name>` | Create an empty migration manually                                               |
| `bunx supabase db push`              | Push migrations to the **default** stack (named stack: see Team member workflow) |
| `bun dev`                            | Next.js dev server (agents should not use it)                                    |
| `bun test`                           | Bun's built-in test runner — **not** Vitest; use `bun run test`                  |
| `bun run test`                       | Vitest: all unit + integration tests (no DB reset)                               |
| `bun test:unit`                      | Run unit tests only                                                              |
| `bun test:integration`               | Run integration tests only                                                       |
| `bun lint`                           | Lint + import/migration/URL guards (does **not** type-check)                     |
| `bun lint:all`                       | Type-check + lint                                                                |
| `gh auth status`                     | Check GitHub CLI authentication                                                  |
| `scripts/pr`                         | Create a PR from current branch via `gh`                                         |
| `scripts/spin <branch>`              | Create worktree + branch for isolated work                                       |

> Plain `bunx supabase start|stop|status|db ...` targets this branch's **default**
> stack because `supabase/config.toml` enables `[experimental] stack = true`.
> For a named stack, set `SUPABASE_STACK` (e.g. `export SUPABASE_STACK=test`)
> and add `--stack "$SUPABASE_STACK"` to `status`/`start`/`stop`/`logs`;
> database commands do not take `--stack` — read the URL and pass it as a remote
> target:
>
> ```bash
> DB_URL=$(bunx supabase status --stack "$SUPABASE_STACK" --env | sed -n "s/^DB_URL='\\(.*\\)'$/\\1/p")
> bunx supabase db reset --remote="$DB_URL" --yes
> ```
>
> Prefer the `bun dev:*` commands — they add the app port checks, build lock and
> generated env files.

---

## Local URLs

Supabase stack endpoints (API, DB, Studio, Mailpit) are assigned per project
(20000-32767) and printed by `bun dev:status`. Fixed services:

| Service                 | URL                                           |
| ----------------------- | --------------------------------------------- |
| App                     | `http://localhost:$APP_PORT` (default `3000`) |
| Grafana (observability) | http://localhost:3001                         |
| Prometheus              | http://localhost:9090                         |
| Tempo (traces API)      | http://localhost:3200                         |
| Loki (logs API)         | http://localhost:3100                         |
| OTLP intake (collector) | http://localhost:4318                         |

A second worktree/branch gets its own stack automatically; only `APP_PORT` needs
a distinct value. The shared QA stack keeps its fixed ports (`:54421` API,
`:54424` Mailpit) until the dashboard can discover stack ports.

---

## Testing

```bash
bun run test          # Run all Vitest tests (does not reset the database)
bun test:unit         # Run unit tests only
bun test:integration  # Run integration tests only
bun test:watch        # Watch mode
bun test:coverage     # Run with coverage report
```

---

## Notes

- `.env.local` is gitignored — **never commit it**
- Each team member must complete these steps independently
- Ensure Docker is running **before** `bun dev:up` and `docker compose up`
- No per-app env file is generated: `scripts/dev` exports this checkout's resolved values to the processes it starts, and `varlock` injects `.env.local` into the `bun run …` scripts
