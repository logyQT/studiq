import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';

export class OrganizationMemberService {
  async getProfile(ctx: RequestContext) {
    const supabase = await createClient();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, organization_id, created_at')
      .eq('id', ctx.userId)
      .single();

    if (error || !profile) {
      throw new AppError('NOT_FOUND');
    }

    return profile;
  }

  async listMembers(ctx: RequestContext, roleFilter?: string) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    let query = supabase
      .from('org_members')
      .select('user_id, role, profiles!inner(id, email, full_name, created_at)')
      .eq('organization_id', ctx.activeOrgId);

    if (roleFilter) {
      query = query.eq('role', roleFilter);
    }

    const { data, error } = await query.order('joined_at', { ascending: false });

    if (error) throw mapSupabaseError(error);

    return data.map((m) => {
      const profile = m.profiles as unknown as { id: string; email: string; full_name: string | null; created_at: string };
      return {
        id: m.user_id,
        email: profile.email,
        full_name: profile.full_name,
        role: m.role,
        organization_id: ctx.activeOrgId,
        created_at: profile.created_at,
      };
    });
  }

  async changeRole(ctx: RequestContext, targetUserId: string, newRole: string) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { error } = await supabase
      .from('org_members')
      .update({ role: newRole })
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', targetUserId);

    if (error) throw mapSupabaseError(error);

    return { success: true };
  }

  async removeMember(ctx: RequestContext, targetUserId: string) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { error } = await supabase
      .from('org_members')
      .delete()
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', targetUserId);

    if (error) throw mapSupabaseError(error);

    return { success: true };
  }
}

export const organizationMemberService = new OrganizationMemberService();
