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

| Prompt | Recommended answer |
|--------|--------------------|
| **GitHub account** | Pick the account that has access to this repo |
| **Preferred protocol** | `HTTPS` (simpler) or `SSH` (if you already have SSH keys) |
| **Authenticate?** | `Yes` — opens a browser for OAuth, or paste a token |

For **headless / CI / agent environments** (no browser available), use a personal access token:

1. Go to <https://github.com/settings/tokens> → **Generate new token (classic)**
2. Select these scopes (see below for details)
3. Paste the token when prompted:

```bash
gh auth login --with-token <<< "ghp_your_token_here"
```

### 3. Required token permissions (scopes)

When creating a PAT for agents or CI, enable these scopes:

| Scope | Why |
|-------|-----|
| **`repo`** | Full control of private repos — push branches, create PRs, read code |
| **`read:org`** | Needed if the repo belongs to a GitHub organization |
| **`workflow`** | Optional — only if agents need to trigger or manage GitHub Actions |

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

This creates a new git worktree under `.worktrees/` with its own branch off `main`.
Move your agent session into it:

```bash
cd .worktrees/feat/my-feature
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
cd .worktrees/feat/my-feature

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

---

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Start local Supabase

```bash
bunx supabase start
```

> First run may take several minutes while Docker pulls images.

Once complete, the terminal will display local API URLs and keys.

### 3. Create `.env.local`

In the project root:

```bash
touch .env.local
```

### 4. Copy environment variables

1. Open [http://127.0.0.1:54323/](http://127.0.0.1:54323/) — local Supabase Studio
2. Click **Connect** (top-right corner)
3. Copy the environment variables and paste them into `.env.local`

Example `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Tracing / Debugging (optional)
TRACE_ENABLED=true            # detailed request tracing in dev terminal
```

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
bunx supabase db reset
```

> `db reset` **deletes all local data** and reloads seed data. Use intentionally.

### 7. Install Playwright browsers (for E2E tests)

```bash
bunx playwright install chromium
```

### 8. Start the development server

```bash
bun dev
```

---

## Stop Local Supabase

```bash
bunx supabase stop
```

> Data is preserved. To clear the database, add the `--no-backup` flag.

---

## Team Collaboration

Local data is **not synced via git** — each team member has their own local database. Migrations and seeds keep everyone in sync.

### Schema changes

After modifying tables in Supabase Studio, generate a migration:

```bash
bunx supabase db diff -f migration_name
```

Supabase compares the current database state with the last migration and writes the diff to `supabase/migrations/`. **Commit this file to git.**

### Seed data

Edit files in `supabase/seeds/` to manage test data. These files are committed to git.

### Author workflow

```bash
# 1. Make changes in Studio (http://127.0.0.1:54323)
# 2. Generate migration
bunx supabase db diff -f migration_name
# 3. Update seeds if needed
# 4. Commit and push
git add supabase/
git commit -m "migration: migration_name"
```

### Team member workflow

```bash
git pull
bunx supabase start        # applies migrations automatically
bunx supabase db reset     # (optional) reloads fresh seed data
```

---

## Useful Commands

| Command | Description |
|---------|-------------|
| `bunx supabase start` | Start local Supabase |
| `bunx supabase stop` | Stop local Supabase |
| `bunx supabase status` | Check status and display API keys |
| `bunx supabase db reset` | Reset database + load seeds |
| `bunx supabase db diff -f <name>` | Generate migration from current changes |
| `bunx supabase migration new <name>` | Create an empty migration manually |
| `bunx supabase db push` | Push migrations to database |
| `bun dev` | Start Next.js development server |
| `bun test` | Reset DB + run all tests |
| `bun test:unit` | Run unit tests only |
| `bun test:integration` | Run integration tests only |
| `bun lint` | Type check + lint |
| `gh auth status` | Check GitHub CLI authentication |
| `scripts/pr` | Create a PR from current branch via `gh` |
| `scripts/spin <branch>` | Create worktree + branch for isolated work |

---

## Local URLs

| Service | URL |
|---------|-----|
| Supabase Studio | http://127.0.0.1:54323 |
| API (REST) | http://127.0.0.1:54321 |
| Auth | http://127.0.0.1:54321/auth/v1 |
| Inbucket (emails) | http://127.0.0.1:54324 |
| App (dev) | http://localhost:3000 |

---

## Testing

```bash
bun test              # Reset DB + run all tests
bun test:unit         # Run unit tests only
bun test:integration  # Run integration tests only
bun test:watch        # Watch mode
bun test:coverage     # Run with coverage report
```

---

## Notes

- `.env.local` is in `.gitignore` — **never commit it**
- Each team member must complete these steps independently
- Ensure Docker Desktop is running **before** `bunx supabase start`
