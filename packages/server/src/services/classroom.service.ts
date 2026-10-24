import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { CreateClassroomInput } from '@studiq/server/models/classroom.model';
import type { SupabaseClient } from '@supabase/supabase-js';

export class ClassroomService {
  // Classroom provisioning is the only thing this service does, and every step
  // runs before the caller is a member: RLS hides the new organization, its
  // trigger-created roles and the membership row from a user-session client, so
  // the whole sequence is service-role (authorization stays in the controller).
  constructor(private createAdminClient: () => SupabaseClient = createServiceClient) {}

  async create(ctx: RequestContext, data: CreateClassroomInput): Promise<ServiceResult<unknown>> {
    const supabase = this.createAdminClient();

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
      .eq('is_system', true)
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
export const classroomService = wrapService(
  new ClassroomService(createServiceClient),
  'classroom.service',
);
