import { User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export function roleGuard(user: User | null, allowedRoles: string[]) {
  // ! FIXME: Tymczasowo na sztywno przypisana rola dla Sprintu 3 (rozwiązanie blokady bazy).
  // ! Należy to zaktualizować na pobieranie roli z tabeli public.profiles lub app_metadata,
  // ! gdy Damian dostarczy finalny schemat bazy danych i migracje.
  const userRole = 'student';

  if (!allowedRoles.includes(userRole)) {
    return {
      hasRole: false,
      response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }),
    };
  }
  return { hasRole: true };
}
