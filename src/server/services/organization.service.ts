import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { CreateOrganizationInput, UpdateOrganizationInput } from '@/server/models';

export class OrganizationService {
  async create(ctx: RequestContext, data: CreateOrganizationInput) {
    const supabase = await createClient();

    const { data: organization, error } = await supabase
      .from('organizations')
      .insert({ name: data.name })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);

    const newOrg = organization;

    const defaultGroupName = 'Członkowie';
    const { error: ge } = await supabase.from('groups').insert({
      organization_id: newOrg.id,
      name: defaultGroupName,
      description: null,
      is_default: true,
    });
    if (ge) throw mapSupabaseError(ge);

    const { data: defaultGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('organization_id', newOrg.id)
      .eq('is_default', true)
      .single();
    if (defaultGroup) {
      const { error: me } = await supabase.from('group_members').insert({
        group_id: defaultGroup.id,
        user_id: ctx.userId,
        role: 'teacher',
      });
      if (me) throw mapSupabaseError(me);
    }

    return newOrg;
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

    const { data: exists } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', id)
      .single();

    if (!exists) {
      throw new AppError('NOT_FOUND');
    }

    const { error } = await supabase.from('organizations').delete().eq('id', id);

    if (error) throw mapSupabaseError(error);

    return { success: true };
  }
}

export const organizationService = new OrganizationService();
