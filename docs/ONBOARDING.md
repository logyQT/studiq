# Onboarding Guide

This guide walks new team members through setting up the local development environment.

---

## Prerequisites

- **Docker Desktop** — must be installed and running before any steps
  [Download Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Node.js 18+** — runtime for the Next.js application
- **pnpm** — package manager (or npm/bun)

---

## Quick Start

### 1. Install dependencies

```bash
pnpm install
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
```

### 5. Seed the database (optional)

```bash
bunx supabase db reset
```

> `db reset` **deletes all local data** and reloads seed data. Use intentionally.

### 6. Start the development server

```bash
pnpm dev
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
pnpm test              # Reset DB + run all tests
pnpm test:unit         # Run unit tests only
pnpm test:integration  # Run integration tests only
pnpm test:watch        # Watch mode
pnpm test:coverage     # Run with coverage report
```

---

## Notes

- `.env.local` is in `.gitignore` — **never commit it**
- Each team member must complete these steps independently
- Ensure Docker Desktop is running **before** `bunx supabase start`
