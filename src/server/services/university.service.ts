import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { CreateUniversityInput } from '@/server/models';

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
}

export const universityService = new UniversityService();
