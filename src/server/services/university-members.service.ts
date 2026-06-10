import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { UserRole } from '@/types';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';

export class UniversityMembersService {
  async getProfile(ctx: RequestContext) {
    const supabase = await createClient();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, university_id, created_at')
      .eq('id', ctx.userId)
      .single();

    if (error || !profile) {
      throw new AppError('NOT_FOUND');
    }

    return profile;
  }

  async listMembers(ctx: RequestContext, roleFilter?: string) {
    const supabase = await createClient();

    if (!ctx.universityId) {
      throw new AppError('FORBIDDEN');
    }

    let query = supabase
      .from('profiles')
      .select('id, email, full_name, role, university_id, created_at')
      .eq('university_id', ctx.universityId);

    if (roleFilter) {
      query = query.eq('role', roleFilter);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw mapSupabaseError(error);

    return data;
  }

  async changeRole(ctx: RequestContext, targetUserId: string, newRole: string) {
    const supabase = await createClient();

    const { error } = await supabase.rpc('admin_change_role', {
      p_target_user: targetUserId,
      p_new_role: newRole,
    });

    if (error) {
      if (error.message.includes('Unauthorized')) {
        throw new AppError('FORBIDDEN');
      }
      throw mapSupabaseError(error);
    }

    return { success: true };
  }

  async removeMember(ctx: RequestContext, targetUserId: string) {
    const supabase = await createClient();

    const { error } = await supabase.rpc('admin_change_role', {
      p_target_user: targetUserId,
      p_new_role: UserRole.FREE,
    });

    if (error) {
      if (error.message.includes('Unauthorized')) {
        throw new AppError('FORBIDDEN');
      }
      throw mapSupabaseError(error);
    }

    return { success: true };
  }
}

export const universityMembersService = new UniversityMembersService();
