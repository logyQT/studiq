-- Enforce NOT NULL + ON DELETE CASCADE on questions.bank_id
ALTER TABLE public.questions ALTER COLUMN bank_id SET NOT NULL;
ALTER TABLE public.questions DROP CONSTRAINT questions_bank_id_fkey;
ALTER TABLE public.questions ADD CONSTRAINT questions_bank_id_fkey
    FOREIGN KEY (bank_id) REFERENCES public.question_banks(id) ON DELETE CASCADE;

-- Enforce NOT NULL on flashcards.deck_id (already CASCADE)
ALTER TABLE public.flashcards ALTER COLUMN deck_id SET NOT NULL;
