-- ============================================
-- MIGRATION: Question Banks & Unified Topics
-- 1. Rename flashcard_topics → topics
-- 2. Create question_banks + assignments
-- 3. Create question_topic_assignments
-- 4. Remove subject_id from questions
-- 5. Drop subjects table
-- ============================================

-- 1. Rename flashcard_topics to topics
ALTER TABLE public.flashcard_topics RENAME TO topics;
ALTER INDEX public.idx_flashcard_topics_created_by RENAME TO idx_topics_created_by;
ALTER INDEX public.idx_flashcard_topics_organization RENAME TO idx_topics_organization;

-- 2. Update FK in flashcard_topic_assignments
ALTER TABLE public.flashcard_topic_assignments
  DROP CONSTRAINT flashcard_topic_assignments_topic_id_fkey,
  ADD CONSTRAINT flashcard_topic_assignments_topic_id_fkey
    FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE;

-- 3. Create question_banks
CREATE TABLE public.question_banks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  name            text NOT NULL,
  description     text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_question_banks_created_by ON public.question_banks(created_by);
CREATE INDEX idx_question_banks_organization ON public.question_banks(organization_id);

-- 4. Create question_bank_assignments (M:N)
CREATE TABLE public.question_bank_assignments (
  question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  bank_id     uuid REFERENCES public.question_banks(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, bank_id)
);

CREATE INDEX idx_question_bank_assignments_bank ON public.question_bank_assignments(bank_id);
CREATE INDEX idx_qba_bank_question ON public.question_bank_assignments(bank_id, question_id);

-- 5. Create question_topic_assignments (M:N)
CREATE TABLE public.question_topic_assignments (
  question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  topic_id    uuid REFERENCES public.topics(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, topic_id)
);

CREATE INDEX idx_question_topic_assignments_topic ON public.question_topic_assignments(topic_id);
CREATE INDEX idx_qta_topic_question ON public.question_topic_assignments(topic_id, question_id);

-- 6. Remove subject_id from questions
ALTER TABLE public.questions DROP COLUMN IF EXISTS subject_id;
DROP INDEX IF EXISTS public.idx_questions_subject;

-- 7. Drop subjects table (pre-market, no users)
DROP TABLE IF EXISTS public.subjects CASCADE;

-- 8. Grant permissions
GRANT ALL ON TABLE public.question_banks TO authenticated, service_role;
GRANT ALL ON TABLE public.question_bank_assignments TO authenticated, service_role;
GRANT ALL ON TABLE public.question_topic_assignments TO authenticated, service_role;
GRANT ALL ON TABLE public.topics TO authenticated, service_role;
