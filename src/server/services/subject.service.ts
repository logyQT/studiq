import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { CreateSubjectInput, UpdateSubjectInput } from '@/server/models';

export class SubjectService {
  async create(data: CreateSubjectInput, userId: string) {
    const supabase = await createClient();

    const { data: subject, error } = await supabase
      .from('subjects')
      .insert({
        name: data.name,
        description: data.description ?? null,
        university_id: data.universityId ?? null,
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw new AppError('INTERNAL_SERVER');
    return subject;
  }

  async list(universityId?: string) {
    const supabase = await createClient();
    let query = supabase.from('subjects').select('*').order('created_at', { ascending: false });
    if (universityId) {
      query = query.eq('university_id', universityId);
    }
    const { data, error } = await query;
    if (error) throw new AppError('INTERNAL_SERVER');
    return data;
  }

  async getById(id: string) {
    const supabase = await createClient();
    const { data, error } = await supabase.from('subjects').select('*').eq('id', id).single();
    if (error || !data) throw new AppError('NOT_FOUND');
    return data;
  }

  async update(id: string, data: UpdateSubjectInput, userId: string) {
    const supabase = await createClient();

    const { data: subject, error } = await supabase
      .from('subjects')
      .update({ name: data.name, description: data.description })
      .eq('id', id)
      .eq('created_by', userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw new AppError('INTERNAL_SERVER');
    if (!subject) throw new AppError('FORBIDDEN');
    return subject;
  }

  async delete(id: string, userId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('subjects')
      .delete()
      .eq('id', id)
      .eq('created_by', userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw new AppError('INTERNAL_SERVER');
    if (!data) throw new AppError('FORBIDDEN');
  }
}

export const subjectService = new SubjectService();
