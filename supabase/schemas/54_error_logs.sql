-- ==========================================
-- TABLE: error_logs
-- Stores unhandled exceptions for debugging.
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
