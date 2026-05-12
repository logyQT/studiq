import { createClient } from '@/lib/supabase/server';
import { AppError, AppErrorCode } from '@/lib/errors';
import type { CreateSpaceInput, UpdateSpaceInput } from '@/server/models';

export class FlashcardSpaceService {
  async create(data: CreateSpaceInput) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data: space, error } = await supabase
      .from('flashcard_spaces')
      .insert({
        name: data.name,
        description: data.description ?? null,
        created_by: user.id,
      })
      .select()
      .single();

    if (error || !space) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

    if (data.flashcardIds && data.flashcardIds.length > 0) {
      const assignments = data.flashcardIds.map((flashcardId) => ({
        space_id: space.id,
        flashcard_id: flashcardId,
      }));
      await supabase.from('flashcard_space_assignments').insert(assignments);
    }

    return this.getById(space.id);
  }

  async list() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data, error } = await supabase
      .from('flashcard_spaces')
      .select('*, flashcard_space_assignments(flashcard_id)')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

    return (data ?? []).map((space) => ({
      ...space,
      flashcard_count: space.flashcard_space_assignments?.length ?? 0,
    }));
  }

  async getById(id: string) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data: space, error } = await supabase
      .from('flashcard_spaces')
      .select('*, flashcard_space_assignments(flashcard_id)')
      .eq('id', id)
      .eq('created_by', user.id)
      .single();

    if (error || !space) throw new AppError(AppErrorCode.NOT_FOUND, 404);

    return {
      ...space,
      flashcard_count: space.flashcard_space_assignments?.length ?? 0,
    };
  }

  async update(id: string, data: UpdateSpaceInput) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const updateFields: Record<string, unknown> = {};
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.description !== undefined) updateFields.description = data.description;

    const { data: space, error } = await supabase
      .from('flashcard_spaces')
      .update(updateFields)
      .eq('id', id)
      .eq('created_by', user.id)
      .select()
      .single();

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    if (!space) throw new AppError(AppErrorCode.FORBIDDEN, 403);

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

    return this.getById(id);
  }

  async delete(id: string) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { error } = await supabase
      .from('flashcard_spaces')
      .delete()
      .eq('id', id)
      .eq('created_by', user.id);

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
  }
}

export const flashcardSpaceService = new FlashcardSpaceService();
