import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';

export class FlashcardPracticeService {
  async log(flashcardId: string, wasCorrect: boolean, userId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_practice')
      .insert({
        user_id: userId,
        flashcard_id: flashcardId,
        was_correct: wasCorrect,
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
}

export const flashcardPracticeService = new FlashcardPracticeService();
