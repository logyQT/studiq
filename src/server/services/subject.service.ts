import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { CreateSubjectInput, UpdateSubjectInput } from '@/server/models';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';

export class SubjectService {
  async create(data: CreateSubjectInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: subject, error } = await supabase
      .from('subjects')
      .insert({
        name: data.name,
        description: data.description ?? null,
        university_id: ctx.universityId,
        created_by: ctx.userId,
      })
      .select()
      .single();
    if (error) throw mapSupabaseError(error);

    return subject;
  }

  async list(ctx: RequestContext) {
    const supabase = await createClient();
    const orConditions = [];

    if (ctx.universityId) orConditions.push(`university_id.eq.${ctx.universityId}`);
    if (ctx.userId) orConditions.push(`created_by.eq.${ctx.userId}`);

    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .order('created_at', { ascending: false })
      .or(orConditions.join(','));

    if (error) throw mapSupabaseError(error);
    return data;
  }

  async getById(id: string, ctx: RequestContext) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .single();
    if (error || !data) throw new AppError('NOT_FOUND');
    return data;
  }

  async update(id: string, data: UpdateSubjectInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: subject, error } = await supabase
      .from('subjects')
      .update({ name: data.name, description: data.description })
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!subject) throw new AppError('FORBIDDEN');
    return subject;
  }

  async delete(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('subjects')
      .delete()
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!data) throw new AppError('FORBIDDEN');
  }
}

export const subjectService = new SubjectService();
