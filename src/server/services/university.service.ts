import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { CreateUniversityInput, UpdateUniversityInput } from '@/server/models';

export class UniversityService {
  async create(data: CreateUniversityInput) {
    const supabase = await createClient();

    const { data: university, error } = await supabase
      .from('universities')
      .insert({
        name: data.name,
        slug: data.slug,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new AppError('CONFLICT');
      }
      console.error('Supabase create university error:', error);
      throw new AppError('INTERNAL_SERVER');
    }

    return university;
  }

  async getAll() {
    const supabase = await createClient();

    const { data: universities, error } = await supabase
      .from('universities')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase get universities error:', error);
      throw new AppError('INTERNAL_SERVER');
    }

    return universities;
  }

  async getById(id: string) {
    const supabase = await createClient();

    const { data: university, error } = await supabase
      .from('universities')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !university) {
      if (error?.code === 'PGRST116') {
        throw new AppError('NOT_FOUND');
      }
      console.error('Supabase get university by id error:', error);
      throw new AppError('INTERNAL_SERVER');
    }

    return university;
  }

  async update(id: string, data: UpdateUniversityInput) {
    const supabase = await createClient();

    const updateData: Partial<CreateUniversityInput> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.slug !== undefined) updateData.slug = data.slug;

    const { data: university, error } = await supabase
      .from('universities')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new AppError('CONFLICT');
      }
      if (error.code === 'PGRST116') {
        throw new AppError('NOT_FOUND');
      }
      console.error('Supabase update university error:', error);
      throw new AppError('INTERNAL_SERVER');
    }

    return university;
  }

  async delete(id: string) {
    const supabase = await createClient();

    const { data: exists } = await supabase.from('universities').select('id').eq('id', id).single();

    if (!exists) {
      throw new AppError('NOT_FOUND');
    }

    const { error } = await supabase.from('universities').delete().eq('id', id);

    if (error) {
      console.error('Supabase delete university error:', error);
      throw new AppError('INTERNAL_SERVER');
    }

    return { success: true };
  }
}

export const universityService = new UniversityService();
