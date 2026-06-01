import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { CreateSubjectInput, UpdateSubjectInput } from '@/server/models';
import { Nullable } from '@/types';

export class SubjectService {
  async create(data: CreateSubjectInput, userId: string) {
    const supabase = await createClient();

    const { data: user } = await supabase
      .from('profiles')
      .select('university_id')
      .eq('id', userId)
      .single();

    const { data: subject, error } = await supabase
      .from('subjects')
      .insert({
        name: data.name,
        description: data.description ?? null,
        university_id: user?.university_id ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new AppError('INTERNAL_SERVER');

    return subject;
  }

  async list(userId: string, universityId: Nullable<string>) {
    const supabase = await createClient();
    const orConditions = [];

    if (universityId) orConditions.push(`university_id.eq.${universityId}`);
    if (userId) orConditions.push(`created_by.eq.${userId}`);

    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .order('created_at', { ascending: false })
      .or(orConditions.join(','));

    if (error) throw new AppError('INTERNAL_SERVER');
    return data;
  }

  async getById(id: string, userId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .eq('id', id)
      .eq('created_by', userId)
      .single();
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
