import { SpanStatusCode, trace } from '@opentelemetry/api';
import { AppError, type AppErrorCode } from '@studiq/server/lib/errors';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { failure } from '@studiq/server/lib/service-result';

interface SupabaseError {
  code: string;
  message: string;
  details?: string;
  hint?: string;
}

/**
 * Annotate the active span with the raw Postgres error before it is collapsed
 * into a generic `AppErrorCode`. Without this a QA-triggered 400 shows up in
 * Tempo as a bare `BAD_REQUEST`, hiding the underlying `23502` constraint
 * message. This is the key that turns #142/#143 into a debuggable span.
 */
function annotateActiveSpan(error: SupabaseError): void {
  const span = trace.getActiveSpan();
  if (!span) return;

  span.setAttributes({
    'db.system': 'postgresql',
    'db.error.code': error.code,
    'db.error.message': error.message,
    ...(error.details ? { 'db.error.details': error.details } : {}),
    ...(error.hint ? { 'db.error.hint': error.hint } : {}),
  });
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: `[${error.code}] ${error.message}`,
  });
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
  annotateActiveSpan(error);

  const mappedCode = PG_ERROR_MAP[error.code];

  if (mappedCode) {
    throw new AppError(mappedCode);
  }

  throw new DatabaseError(error);
}

export function toDbFailure(error: SupabaseError): ServiceResult<never> {
  annotateActiveSpan(error);

  const code = PG_ERROR_MAP[error.code];
  return code ? failure(code) : failure('INTERNAL_SERVER');
}
