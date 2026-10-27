import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

// #657: get_student_insights is SECURITY INVOKER and refuses to run for another user. A real seed
// student signs in with the anon key, the path a browser takes.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const STUDENT_ID = '00000000-0000-4000-8001-000000000005'; // student1@dev.local
const OTHER_USER_ID = '00000000-0000-4000-8001-000000000003';

describe('get_student_insights (#657)', () => {
  let student: SupabaseClient;

  beforeAll(async () => {
    student = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await student.auth.signInWithPassword({
      email: 'student1@dev.local',
      password: 'pass',
    });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  });

  it('answers the three blocks for the caller', async () => {
    const { data, error } = await student.rpc('get_student_insights', {
      p_user_id: STUDENT_ID,
      p_days: 30,
    });

    expect(error).toBeNull();
    expect(data.days).toBe(30);
    expect(Array.isArray(data.mastery)).toBe(true);
    expect(data.studyTime.byWeekday).toHaveLength(7);
    expect(data.retention.map((b: { bucket: string }) => b.bucket)).toEqual([
      'd0',
      'd1',
      'd2_3',
      'd4_7',
      'd8_14',
      'd15_30',
      'd31_plus',
    ]);
  });

  it('keeps the window between 1 and 365 days', async () => {
    const wide = await student.rpc('get_student_insights', { p_user_id: STUDENT_ID, p_days: 9999 });
    const narrow = await student.rpc('get_student_insights', { p_user_id: STUDENT_ID, p_days: 0 });

    expect(wide.data.days).toBe(365);
    expect(narrow.data.days).toBe(1);
  });

  it('refuses to run for another user (42501)', async () => {
    const { error } = await student.rpc('get_student_insights', {
      p_user_id: OTHER_USER_ID,
      p_days: 30,
    });

    expect(error?.code).toBe('42501');
  });
});
