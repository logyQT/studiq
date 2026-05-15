import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';

export class FlashcardPracticeService {
  async log(
    flashcardId: string,
    wasCorrect: boolean,
    userId: string,
    responseTimeMs?: number,
    confidenceLevel?: number,
    sessionId?: string,
  ) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_practice')
      .insert({
        user_id: userId,
        flashcard_id: flashcardId,
        was_correct: wasCorrect,
        response_time_ms: responseTimeMs ?? null,
        confidence_level: confidenceLevel ?? null,
        session_id: sessionId ?? null,
      })
      .select()
      .single();

    if (error) throw new AppError('INTERNAL_SERVER');
    return data;
  }

  async getHistory(userId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_practice')
      .select('*, flashcards(front, back)')
      .eq('user_id', userId)
      .order('practiced_at', { ascending: false });

    if (error) throw new AppError('INTERNAL_SERVER');
    return data;
  }

  async getHistoryForFlashcard(flashcardId: string, userId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_practice')
      .select('*, flashcards(front, back)')
      .eq('flashcard_id', flashcardId)
      .eq('user_id', userId)
      .order('practiced_at', { ascending: false });

    if (error) throw new AppError('INTERNAL_SERVER');
    return data;
  }

}

export const flashcardPracticeService = new FlashcardPracticeService();
