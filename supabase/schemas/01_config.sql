-- ==========================================
-- TEXT SEARCH CONFIGURATIONS
-- Must exist before any table uses them in
-- generated columns or function bodies.
-- ==========================================

-- Polish text search configuration for bilingual full-text search
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'polish') THEN
    CREATE TEXT SEARCH CONFIGURATION public.polish (COPY = pg_catalog.simple);
  END IF;
END $$;
