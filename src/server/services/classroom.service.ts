import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { CreateClassroomInput } from '@/server/models';

export class ClassroomService {
  async create(ctx: RequestContext, data: CreateClassroomInput) {
    const supabase = await createClient();

    const slug =
      data.slug ??
      data.name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({ name: data.name, slug })
      .select()
      .single();

    if (orgError) throw mapSupabaseError(orgError);

    const { error: memberError } = await supabase.from('org_members').insert({
      organization_id: org.id,
      user_id: ctx.userId,
      role: ctx.role,
    });

    if (memberError) {
      await supabase.from('organizations').delete().eq('id', org.id);
      throw mapSupabaseError(memberError);
    }

    return org;
  }
}

export const classroomService = new ClassroomService();
