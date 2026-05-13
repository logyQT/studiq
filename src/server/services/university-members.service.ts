import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { UserRole } from '@/types';

export class UniversityMembersService {
  async getProfile(userId: string) {
    const supabase = await createClient();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, university_id, created_at')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      throw new AppError('NOT_FOUND');
    }

    return profile;
  }

  async listMembers(universityId: string, roleFilter?: string) {
    const supabase = await createClient();

    let query = supabase
      .from('profiles')
      .select('id, email, full_name, role, university_id, created_at')
      .eq('university_id', universityId);

    if (roleFilter) {
      query = query.eq('role', roleFilter);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new AppError('INTERNAL_SERVER');
    }

    return data;
  }

  async changeRole(requestingUserId: string, targetUserId: string, newRole: string) {
    const supabase = await createClient();

    const { error } = await supabase.rpc('admin_change_role', {
      p_target_user: targetUserId,
      p_new_role: newRole,
    });

    if (error) {
      if (error.message.includes('Unauthorized')) {
        throw new AppError('FORBIDDEN');
      }
      throw new AppError('INTERNAL_SERVER');
    }

    return { success: true };
  }

  async removeMember(requestingUserId: string, targetUserId: string) {
    const supabase = await createClient();

    const { error } = await supabase.rpc('admin_change_role', {
      p_target_user: targetUserId,
      p_new_role: UserRole.FREE,
    });

    if (error) {
      if (error.message.includes('Unauthorized')) {
        throw new AppError('FORBIDDEN');
      }
      throw new AppError('INTERNAL_SERVER');
    }

    return { success: true };
  }
}

export const universityMembersService = new UniversityMembersService();
