import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type { CreateDeckInput, UpdateDeckInput, BatchDeleteDeckInput } from '@/server/models';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';
import { checkPermission, shouldSetUniversityId, buildQueryFilter, Permission } from '@/lib/rbac';

export class FlashcardDeckService {
  async create(data: CreateDeckInput, ctx: RequestContext) {
    const supabase = await createClient();
    const universityId = await shouldSetUniversityId(ctx, Permission.DECK_CREATE) ? ctx.universityId : null;

    const { data: deck, error } = await supabase
      .from('flashcard_decks')
      .insert({
        name: data.name,
        description: data.description ?? null,
        created_by: ctx.userId,
        university_id: universityId,
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

    const filter = await buildQueryFilter(ctx, Permission.DECK_READ, 'deck');
    let query = supabase
      .from('flashcard_decks')
      .select('*, flashcard_deck_assignments(flashcard_id)')
      .order('created_at', { ascending: false });

    if (filter._impossible) return [];
    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);

    return (data ?? []).map((deck) => ({
      ...deck,
      flashcard_count: deck.flashcard_deck_assignments?.length ?? 0,
    }));
  }

  async getById(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.DECK_READ, 'deck');
    let query = supabase
      .from('flashcard_decks')
      .select('*, flashcard_deck_assignments(flashcard_id)')
      .eq('id', id);

    if (filter._impossible) throw new AppError('NOT_FOUND');
    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    const { data: deck, error } = await query.single();
    if (error || !deck) throw new AppError('NOT_FOUND');

    return {
      ...deck,
      flashcard_count: deck.flashcard_deck_assignments?.length ?? 0,
    };
  }

  async update(id: string, data: UpdateDeckInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_UPDATE, existing);

    const updateFields: Record<string, unknown> = {};
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.description !== undefined) updateFields.description = data.description;

    const { data: deck, error } = await supabase
      .from('flashcard_decks')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    if (!deck) throw new AppError('NOT_FOUND');

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

    const { data: existing, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_DELETE, existing);

    const { error } = await supabase
      .from('flashcard_decks')
      .delete()
      .eq('id', id);

    if (error) throw mapSupabaseError(error);
  }

  async batchDelete(data: BatchDeleteDeckInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: decks, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('*')
      .in('id', data.ids);

    if (fetchError) throw mapSupabaseError(fetchError);
    if (!decks || decks.length === 0) throw new AppError('NOT_FOUND');

    for (const deck of decks) {
      await checkPermission(ctx, Permission.DECK_DELETE, deck);
    }

    const { error } = await supabase
      .from('flashcard_decks')
      .delete()
      .in('id', data.ids);

    if (error) throw mapSupabaseError(error);

    return { deleted: data.ids.length };
  }
}

export const flashcardDeckService = new FlashcardDeckService();
