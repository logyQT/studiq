# ADR-0001: Use Supabase for Database and Authentication

## Status

Accepted

## Context

The application required a PostgreSQL database, user authentication with SSR support, email flows (confirmation, password reset), and a developer-friendly local development experience.

## Decision

Supabase was selected as the combined database, authentication, and backend provider.

## Consequences

### Positive
- Integrated PostgreSQL with managed backups and scaling
- Built-in auth with SSR cookie support via `@supabase/ssr`
- Local development via `supabase CLI` + Docker
- Migration and seed system built into the CLI
- Row Level Security available for future use
- Free tier sufficient for development and early production

### Negative
- Vendor lock-in to Supabase ecosystem
- External dependency for core infrastructure
- Limited control over PostgreSQL configuration compared to self-hosted
