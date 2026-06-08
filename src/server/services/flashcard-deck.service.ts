import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type { CreateDeckInput, UpdateDeckInput } from '@/server/models';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';

export class FlashcardDeckService {
  async create(data: CreateDeckInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: deck, error } = await supabase
      .from('flashcard_decks')
      .insert({
        name: data.name,
        description: data.description ?? null,
        created_by: ctx.userId,
        university_id: ctx.universityId,
      })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    if (!deck) throw new AppError('NOT_FOUND');

    if (data.flashcardIds && data.flashcardIds.length > 0) {
      const assignments = data.flashcardIds.map((flashcardId) => ({
        deck_id: deck.id,
        flashcard_id: flashcardId,
      }));
      await supabase.from('flashcard_deck_assignments').insert(assignments);
    }

    return this.getById(deck.id, ctx);
  }

  async list(ctx: RequestContext) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_decks')
      .select('*, flashcard_deck_assignments(flashcard_id)')
      .eq('created_by', ctx.userId)
      .order('created_at', { ascending: false });

    if (error) throw mapSupabaseError(error);

    return (data ?? []).map((deck) => ({
      ...deck,
      flashcard_count: deck.flashcard_deck_assignments?.length ?? 0,
    }));
  }

  async getById(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: deck, error } = await supabase
      .from('flashcard_decks')
      .select('*, flashcard_deck_assignments(flashcard_id)')
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .single();

    if (error || !deck) throw new AppError('NOT_FOUND');

    return {
      ...deck,
      flashcard_count: deck.flashcard_deck_assignments?.length ?? 0,
    };
  }

  async update(id: string, data: UpdateDeckInput, ctx: RequestContext) {
    const supabase = await createClient();

    const updateFields: Record<string, unknown> = {};
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.description !== undefined) updateFields.description = data.description;

    const { data: deck, error } = await supabase
      .from('flashcard_decks')
      .update(updateFields)
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!deck) throw new AppError('FORBIDDEN');

    if (data.flashcardIds !== undefined) {
      await supabase.from('flashcard_deck_assignments').delete().eq('deck_id', id);
      if (data.flashcardIds.length > 0) {
        const assignments = data.flashcardIds.map((flashcardId) => ({
          deck_id: id,
          flashcard_id: flashcardId,
        }));
        await supabase.from('flashcard_deck_assignments').insert(assignments);
      }
    }

    return this.getById(id, ctx);
  }

  async delete(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_decks')
      .delete()
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!data) throw new AppError('FORBIDDEN');
  }
}

export const flashcardDeckService = new FlashcardDeckService();
