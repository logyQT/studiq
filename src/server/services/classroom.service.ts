import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';
import type { CreateClassroomInput } from '@/server/models';

export class ClassroomService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async create(ctx: RequestContext, data: CreateClassroomInput): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({ name: data.name })
      .select()
      .single();

    if (orgError) return toDbFailure(orgError);

    const { data: adminRole } = await supabase
      .from('org_roles')
      .select('id')
      .eq('organization_id', org.id)
      .eq('name', 'admin')
      .single();
    if (!adminRole) {
      await supabase.from('organizations').delete().eq('id', org.id);
      return failure('INTERNAL_SERVER');
    }

    const { error: memberError } = await supabase.from('org_members').insert({
      organization_id: org.id,
      user_id: ctx.userId,
      org_role_id: adminRole.id,
    });

    if (memberError) {
      await supabase.from('organizations').delete().eq('id', org.id);
      return toDbFailure(memberError);
    }

    return success({ ...org, adminRoleId: adminRole.id });
  }
}
