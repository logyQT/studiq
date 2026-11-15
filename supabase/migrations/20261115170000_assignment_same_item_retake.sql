-- ==========================================
-- Same-item retakes are an explicit choice (#1174, R6)
--
-- Fresh-sample retakes are the default: a retake draws only items this student has not seen, so the
-- second attempt cannot be a memory test of the first. `allow_same_item_retake` is the teacher's
-- opt-in to serve the same set again inside the window — a deliberate, flagged exception (a
-- repeated drill, not an assessment of unseen material), never the silent default.
--
-- In-window only: the attempt gate already refuses a start outside `[start_time, close)`, so this
-- flag can never produce a post-close retake, and it never withholds the review afterwards.
-- ==========================================

ALTER TABLE public.teacher_assignments
  ADD COLUMN IF NOT EXISTS allow_same_item_retake boolean NOT NULL DEFAULT false;
