import { createClient } from '@/lib/supabase/server';
import { AppError, AppErrorCode } from '@/lib/errors';
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
        throw new AppError(AppErrorCode.SLUG_ALREADY_EXISTS, 409);
      }
      console.error('Supabase create university error:', error);
      throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    }

    return university;
  }
}

export const universityService = new UniversityService();
