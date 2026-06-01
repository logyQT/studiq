import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';

export class FlashcardPracticeService {
  async log(
    flashcardId: string,
    wasCorrect: boolean,
    ctx: RequestContext,
    responseTimeMs?: number,
    confidenceLevel?: number,
    sessionId?: string,
  ) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_practice')
      .insert({
        user_id: ctx.userId,
        flashcard_id: flashcardId,
        was_correct: wasCorrect,
        response_time_ms: responseTimeMs ?? null,
        confidence_level: confidenceLevel ?? null,
        session_id: sessionId ?? null,
      })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    return data;
  }

  async getHistory(ctx: RequestContext) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_practice')
      .select('*, flashcards(front, back)')
      .eq('user_id', ctx.userId)
      .order('practiced_at', { ascending: false });

    if (error) throw mapSupabaseError(error);
    return data;
  }

  async getHistoryForFlashcard(flashcardId: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_practice')
      .select('*, flashcards(front, back)')
      .eq('flashcard_id', flashcardId)
      .eq('user_id', ctx.userId)
      .order('practiced_at', { ascending: false });

    if (error) throw mapSupabaseError(error);
    return data;
  }
}

export const flashcardPracticeService = new FlashcardPracticeService();
