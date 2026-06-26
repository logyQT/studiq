# Deployment

## Hosting

### Recommended Setup

| Component | Platform |
|-----------|----------|
| Frontend + API | Vercel |
| Database + Auth | Supabase (cloud) |

## Environment Variables

The following variables must be configured in production:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SITE_URL=https://your-domain.com

# LLM / AI Provider (optional — only if using AI features)
LLM_PROVIDER=openai
LLM_API_KEY=your-openai-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL_NAME=gpt-4o-mini

# Tracing (dev/staging only — noop in production unless set)
TRACE_ENABLED=true             # per-layer request tracing in console
```

### Vercel Configuration

1. Connect your GitHub repository to Vercel
2. Add environment variables in Vercel project settings
3. Set the build command to `bun run build`
4. Set the output directory to `.next`

### Supabase Configuration

1. Create a project at [supabase.com](https://supabase.com)
2. Run migrations: `bunx supabase db push`
3. Seed production data if needed
4. Configure auth settings:
   - Site URL
   - Redirect URLs
   - Email templates

## Production Considerations

- **HTTPS** — Vercel provides automatic HTTPS
- **Environment security** — never commit `.env.local` or service role keys
- **Email templates** — customize Supabase auth emails (confirmation, password reset, invite)
- **CORS** — configure if API is accessed from external domains
- **Rate limiting** — consider adding rate limits for public endpoints
- **Monitoring** — set up error tracking (Sentry, Vercel Analytics)

## Build and Deploy

```bash
# Build locally
bun run build

# Start production server locally
bun start

# Deploy to Vercel (if CLI is installed)
vercel --prod
```

## Database Migrations

Push migrations to production Supabase:

```bash
bunx supabase db push
```

This applies any local migrations that haven't been applied to the remote database.
