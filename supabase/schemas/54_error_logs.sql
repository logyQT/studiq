-- ==========================================
-- TABLE: error_logs
-- Purpose: Store unhandled exceptions with UUID for debugging
-- Depends on: 04_profiles.sql
-- ==========================================

CREATE TABLE public.error_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  error_code  text NOT NULL,
  message     text NOT NULL,
  stack_trace text,
  url         text,
  method      text,
  user_id     uuid REFERENCES public.profiles(id),
  metadata    jsonb,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_error_logs_created_at ON public.error_logs(created_at DESC);
CREATE INDEX idx_error_logs_error_code ON public.error_logs(error_code);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

GRANT DELETE ON TABLE public.error_logs TO service_role;
GRANT INSERT ON TABLE public.error_logs TO service_role;
GRANT REFERENCES ON TABLE public.error_logs TO service_role;
GRANT SELECT ON TABLE public.error_logs TO service_role;
GRANT TRIGGER ON TABLE public.error_logs TO service_role;
GRANT TRUNCATE ON TABLE public.error_logs TO service_role;
GRANT UPDATE ON TABLE public.error_logs TO service_role;
