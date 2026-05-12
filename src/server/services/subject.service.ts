import { createClient } from '@/lib/supabase/server';
import { AppError, AppErrorCode } from '@/lib/errors';
import type { CreateSubjectInput, UpdateSubjectInput } from '@/server/models';

export class SubjectService {
  async create(data: CreateSubjectInput) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data: subject, error } = await supabase
      .from('subjects')
      .insert({
        name: data.name,
        description: data.description ?? null,
        university_id: data.universityId ?? null,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    return subject;
  }

  async list(universityId?: string) {
    const supabase = await createClient();
    let query = supabase.from('subjects').select('*').order('created_at', { ascending: false });
    if (universityId) {
      query = query.eq('university_id', universityId);
    }
    const { data, error } = await query;
    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    return data;
  }

  async getById(id: string) {
    const supabase = await createClient();
    const { data, error } = await supabase.from('subjects').select('*').eq('id', id).single();
    if (error || !data) throw new AppError(AppErrorCode.NOT_FOUND, 404);
    return data;
  }

  async update(id: string, data: UpdateSubjectInput) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data: subject, error } = await supabase
      .from('subjects')
      .update({ name: data.name, description: data.description })
      .eq('id', id)
      .eq('created_by', user.id)
      .select()
      .single();

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    if (!subject) throw new AppError(AppErrorCode.FORBIDDEN, 403);
    return subject;
  }

  async delete(id: string) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { error } = await supabase
      .from('subjects')
      .delete()
      .eq('id', id)
      .eq('created_by', user.id);

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
  }
}

export const subjectService = new SubjectService();
