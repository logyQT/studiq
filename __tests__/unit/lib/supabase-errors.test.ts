import { mapSupabaseError, toDbFailure } from '@studiq/server/lib/supabase-errors';
import { describe, expect, it } from 'vitest';

// RLS / grant denials are authorization failures. Before #191 they collapsed
// into a 500 (DatabaseError), which hid PostgREST-level policy rejections behind
// "internal server error" while still denying the write.
describe('supabase error mapping', () => {
  it('maps 42501 (insufficient_privilege) to FORBIDDEN', () => {
    expect(
      toDbFailure({ code: '42501', message: 'new row violates row-level security policy' }),
    ).toEqual({ success: false, error: 'FORBIDDEN' });
  });

  it('throws a FORBIDDEN AppError from mapSupabaseError', () => {
    expect(() => mapSupabaseError({ code: '42501', message: 'permission denied' })).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('keeps unmapped database errors as INTERNAL_SERVER', () => {
    expect(toDbFailure({ code: 'XX000', message: 'boom' })).toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });
});
