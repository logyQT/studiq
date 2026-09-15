-- ==========================================================
-- DROP: error_logs (dead schema — never written)
-- Created in 20260601114203 with zero application writers:
--   * no code inserts into error_logs (grep: src/ → empty)
--   * the /admin/logs page consuming it fetched a route
--     (/api/v1/admin/error-logs) that never existed
--   * error tracking is OTEL/Jaeger spans via withAuth,
--     withSupervision and wrapService
-- Removed cleanly, no backward-compat stub.
-- ==========================================================

DROP TABLE IF EXISTS public.error_logs;