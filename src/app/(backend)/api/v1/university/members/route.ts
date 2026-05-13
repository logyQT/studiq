import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toNextResponse } from '@/lib/http-utils';
import { universityMembersController } from '@/server/controllers/university-members.controller';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { searchParams } = new URL(req.url);
  const roleFilter = searchParams.get('role') || undefined;

  const response = await universityMembersController.listMembers(user.id, roleFilter);
  return toNextResponse(response);
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const body = await req.json();
  const response = await universityMembersController.changeRole(user.id, body);
  return toNextResponse(response);
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { searchParams } = new URL(req.url);
  const targetUserId = searchParams.get('userId') || '';

  const response = await universityMembersController.removeMember(user.id, targetUserId);
  return toNextResponse(response);
}
