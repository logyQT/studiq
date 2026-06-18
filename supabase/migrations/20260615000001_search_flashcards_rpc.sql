-- RPC function for bilingual full-text search across flashcards
-- Queries both English and Polish tsvector configs, OR'd together
-- Ranked by sum of ts_rank for both languages

CREATE OR REPLACE FUNCTION public.search_flashcards(
  search_query text,
  result_limit int DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  front text,
  back text,
  rank real,
  deck_id uuid,
  deck_name text
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  en_query tsquery;
  pl_query tsquery;
BEGIN
  IF search_query IS NULL OR trim(search_query) = '' THEN
    RETURN;
  END IF;

  en_query := plainto_tsquery('english', search_query);
  pl_query := plainto_tsquery('polish', search_query);

  RETURN QUERY
  SELECT
    f.id,
    f.front,
    f.back,
    ts_rank(f.search_vector, en_query) + ts_rank(f.search_vector, pl_query) AS rank,
    d.id,
    d.name
  FROM public.flashcards f
  LEFT JOIN public.flashcard_deck_assignments fda ON fda.flashcard_id = f.id
  LEFT JOIN public.flashcard_decks d ON d.id = fda.deck_id
  WHERE f.search_vector @@ en_query OR f.search_vector @@ pl_query
  ORDER BY rank DESC
  LIMIT result_limit;
END;
$$;
