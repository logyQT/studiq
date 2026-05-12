import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AppError, AppErrorCode, handleApiError } from '@/lib/errors';
import { UserRole } from '@/types';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: AppErrorCode.UNAUTHORIZED }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('university_id, role')
      .eq('id', user.id)
      .single();

    if (!profile?.university_id) {
      return NextResponse.json({ error: AppErrorCode.FORBIDDEN }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const roleFilter = searchParams.get('role') || undefined;

    let query = supabase
      .from('profiles')
      .select('id, email, full_name, role, university_id, created_at')
      .eq('university_id', profile.university_id);

    if (roleFilter) query = query.eq('role', roleFilter);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: AppErrorCode.UNAUTHORIZED }, { status: 401 });

    const body = await req.json();
    const { targetUserId, newRole } = body;

    if (!targetUserId || !newRole) {
      return NextResponse.json({ error: AppErrorCode.INVALID_INPUT }, { status: 400 });
    }

    const { error } = await supabase.rpc('admin_change_role', {
      p_target_user: targetUserId,
      p_new_role: newRole,
    });

    if (error) {
      if (error.message.includes('Unauthorized')) {
        return NextResponse.json({ error: AppErrorCode.FORBIDDEN }, { status: 403 });
      }
      throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: AppErrorCode.UNAUTHORIZED }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get('userId');
    if (!targetUserId) {
      return NextResponse.json({ error: AppErrorCode.INVALID_INPUT }, { status: 400 });
    }

    const { error } = await supabase.rpc('admin_change_role', {
      p_target_user: targetUserId,
      p_new_role: UserRole.FREE,
    });

    if (error) {
      if (error.message.includes('Unauthorized')) {
        return NextResponse.json({ error: AppErrorCode.FORBIDDEN }, { status: 403 });
      }
      throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
