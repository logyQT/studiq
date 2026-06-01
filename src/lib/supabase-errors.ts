import { AppError, AppErrorCode } from '@/lib/errors';

interface SupabaseError {
  code: string;
  message: string;
  details?: string;
  hint?: string;
}

const PG_ERROR_MAP: Record<string, AppErrorCode> = {
  PGRST116: 'NOT_FOUND',
  '23505': 'CONFLICT',
  '23503': 'BAD_REQUEST',
  '23502': 'BAD_REQUEST',
  '23514': 'BAD_REQUEST',
};

export class DatabaseError extends Error {
  readonly code: string;
  readonly details?: string;
  readonly hint?: string;

  constructor(supabaseError: SupabaseError) {
    super(supabaseError.message);
    this.name = 'DatabaseError';
    this.code = supabaseError.code;
    this.details = supabaseError.details;
    this.hint = supabaseError.hint;
  }
}

export function mapSupabaseError(error: SupabaseError): never {
  const mappedCode = PG_ERROR_MAP[error.code];

  if (mappedCode) {
    throw new AppError(mappedCode);
  }

  throw new DatabaseError(error);
}
