# Weak Points Fix Plan

## Root Cause

PostgREST enforces a 1,000-row cap on unbounded SELECT queries. `getWeakPoints()` fetches `flashcard_practice` without `.limit()`, gets only first 1,000 of ~7,000 records → 100% accuracy skew.

## Fix: Two PostgreSQL Views + Clean Service

### Migration: `supabase/migrations/20260629000006_weak_points_views.sql`

```sql
-- Aggregate practice by deck
CREATE OR REPLACE VIEW public.weak_decks_view AS
SELECT
  fp.user_id,
  fda.deck_id,
  fd.name,
  COUNT(*) AS total_attempts,
  COUNT(*) FILTER (WHERE fp.was_correct) AS correct_count,
  ROUND((COUNT(*) FILTER (WHERE fp.was_correct))::numeric / GREATEST(COUNT(*), 1) * 100)::int AS accuracy
FROM public.flashcard_practice fp
JOIN public.flashcard_deck_assignments fda ON fda.flashcard_id = fp.flashcard_id
JOIN public.flashcard_decks fd ON fd.id = fda.deck_id
GROUP BY fp.user_id, fda.deck_id, fd.name;

-- Aggregate practice by topic
CREATE OR REPLACE VIEW public.weak_topics_view AS
SELECT
  fp.user_id,
  fta.topic_id,
  ft.name,
  COUNT(*) AS total_attempts,
  COUNT(*) FILTER (WHERE fp.was_correct) AS correct_count,
  ROUND((COUNT(*) FILTER (WHERE fp.was_correct))::numeric / GREATEST(COUNT(*), 1) * 100)::int AS accuracy
FROM public.flashcard_practice fp
JOIN public.flashcard_topic_assignments fta ON fta.flashcard_id = fp.flashcard_id
JOIN public.flashcard_topics ft ON ft.id = fta.topic_id
GROUP BY fp.user_id, fta.topic_id, ft.name;

GRANT SELECT ON public.weak_decks_view TO authenticated, service_role;
GRANT SELECT ON public.weak_topics_view TO authenticated, service_role;
```

### Service: `src/server/services/stats.service.ts`

Replace `getWeakPoints()` body with:

```typescript
async getWeakPoints(ctx: RequestContext) {
  const supabase = await createClient();

  const [decksRes, topicsRes] = await Promise.all([
    supabase
      .from('weak_decks_view')
      .select('deck_id, name, accuracy, total_attempts')
      .eq('user_id', ctx.userId)
      .gte('total_attempts', 5)
      .order('accuracy', { ascending: true })
      .limit(5),
    supabase
      .from('weak_topics_view')
      .select('topic_id, name, accuracy, total_attempts')
      .eq('user_id', ctx.userId)
      .gte('total_attempts', 5)
      .order('accuracy', { ascending: true })
      .limit(5),
  ]);

  return {
    weakDecks: (decksRes.data ?? []).map((d: Record<string, unknown>) => ({
      deckId: d.deck_id as string,
      name: d.name as string,
      accuracy: d.accuracy as number,
      totalAttempts: d.total_attempts as number,
    })),
    weakTopics: (topicsRes.data ?? []).map((t: Record<string, unknown>) => ({
      topicId: t.topic_id as string,
      name: t.name as string,
      accuracy: t.accuracy as number,
      totalAttempts: t.total_attempts as number,
    })),
  };
}
```

### Files to change

| File | Action |
|------|--------|
| `supabase/migrations/20260629000006_weak_points_views.sql` | **NEW** |
| `src/server/services/stats.service.ts` | Replace `getWeakPoints()` body |

### Why this works

Views execute inside PostgreSQL before results are returned — PostgREST's 1,000-row cap does NOT apply. The `.limit(5)` on the view query only fetches 5 rows from the already-aggregated result.
