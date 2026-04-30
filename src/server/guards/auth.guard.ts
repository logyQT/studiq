import { AppErrorCode } from '@/lib/errors';
import { User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export function authGuard(user: User | null) {
  if (!user) {
    return {
      isAuthorized: false,
      response: NextResponse.json(
        { success: false, error: AppErrorCode.UNAUTHORIZED },
        { status: 401 },
      ),
    };
  }
  return { isAuthorized: true };
}
