import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { CreateOrganizationInput, UpdateOrganizationInput } from '@/server/models';
import { mapSupabaseError } from '@/lib/supabase-errors';

export class OrganizationService {
  async create(data: CreateOrganizationInput) {
    const supabase = await createClient();

    const { data: organization, error } = await supabase
      .from('organizations')
      .insert({
        name: data.name,
        slug: data.slug,
      })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);

    return organization;
  }

  async getAll() {
    const supabase = await createClient();

    const { data: organizations, error } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw mapSupabaseError(error);

    return organizations;
  }

  async getById(id: string) {
    const supabase = await createClient();

    const { data: organization, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !organization) {
      if (error?.code === 'PGRST116') throw new AppError('NOT_FOUND');
      if (error) throw mapSupabaseError(error);
      throw new AppError('NOT_FOUND');
    }

    return organization;
  }

  async update(id: string, data: UpdateOrganizationInput) {
    const supabase = await createClient();

    const updateData: Partial<CreateOrganizationInput> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.slug !== undefined) updateData.slug = data.slug;

    const { data: organization, error } = await supabase
      .from('organizations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw mapSupabaseError(error);

    return organization;
  }

  async delete(id: string) {
    const supabase = await createClient();

    const { data: exists } = await supabase.from('organizations').select('id').eq('id', id).single();

    if (!exists) {
      throw new AppError('NOT_FOUND');
    }

    const { error } = await supabase.from('organizations').delete().eq('id', id);

    if (error) throw mapSupabaseError(error);

    return { success: true };
  }
}

export const organizationService = new OrganizationService();
