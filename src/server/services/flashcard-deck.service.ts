import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type { CreateSpaceInput, UpdateSpaceInput } from '@/server/models';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';

export class FlashcardSpaceService {
  async create(data: CreateSpaceInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: space, error } = await supabase
      .from('flashcard_spaces')
      .insert({
        name: data.name,
        description: data.description ?? null,
        created_by: ctx.userId,
        university_id: ctx.universityId,
      })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    if (!space) throw new AppError('NOT_FOUND');

    if (data.flashcardIds && data.flashcardIds.length > 0) {
      const assignments = data.flashcardIds.map((flashcardId) => ({
        space_id: space.id,
        flashcard_id: flashcardId,
      }));
      await supabase.from('flashcard_space_assignments').insert(assignments);
    }

    return this.getById(space.id, ctx);
  }

  async list(ctx: RequestContext) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_spaces')
      .select('*, flashcard_space_assignments(flashcard_id)')
      .eq('created_by', ctx.userId)
      .order('created_at', { ascending: false });

    if (error) throw mapSupabaseError(error);

    return (data ?? []).map((space) => ({
      ...space,
      flashcard_count: space.flashcard_space_assignments?.length ?? 0,
    }));
  }

  async getById(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: space, error } = await supabase
      .from('flashcard_spaces')
      .select('*, flashcard_space_assignments(flashcard_id)')
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .single();

    if (error || !space) throw new AppError('NOT_FOUND');

    return {
      ...space,
      flashcard_count: space.flashcard_space_assignments?.length ?? 0,
    };
  }

  async update(id: string, data: UpdateSpaceInput, ctx: RequestContext) {
    const supabase = await createClient();

    const updateFields: Record<string, unknown> = {};
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.description !== undefined) updateFields.description = data.description;

    const { data: space, error } = await supabase
      .from('flashcard_spaces')
      .update(updateFields)
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!space) throw new AppError('FORBIDDEN');

    if (data.flashcardIds !== undefined) {
      await supabase.from('flashcard_space_assignments').delete().eq('space_id', id);
      if (data.flashcardIds.length > 0) {
        const assignments = data.flashcardIds.map((flashcardId) => ({
          space_id: id,
          flashcard_id: flashcardId,
        }));
        await supabase.from('flashcard_space_assignments').insert(assignments);
      }
    }

    return this.getById(id, ctx);
  }

  async delete(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_spaces')
      .delete()
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!data) throw new AppError('FORBIDDEN');
  }
}

export const flashcardSpaceService = new FlashcardSpaceService();
