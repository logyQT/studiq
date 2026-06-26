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
# LLM_BASE_URL=http://localhost:11434
# LLM_MODEL_NAME=llama3.2
```

To use Ollama, install it from [ollama.com](https://ollama.com) and pull a model:

```bash
ollama pull llama3.2
```

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
