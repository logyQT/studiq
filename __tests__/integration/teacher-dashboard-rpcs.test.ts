import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

// #654: get_teacher_group_performance / get_teacher_activity_feed are SECURITY DEFINER (teachers
// cannot read other users' flashcard_practice through RLS), so they must not be a cross-user or
// cross-tenant oracle. Real seed users sign in with the anon key, the path a browser takes.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const TEACHER_ID = '00000000-0000-4000-8001-000000000003'; // teacher1@dev.local
const OTHER_USER_ID = '00000000-0000-4000-8001-000000000001';
const ORG = '00000000-0000-4000-8000-000000000001'; // WSB Merito, teacher1 is a member
const FOREIGN_ORG = '00000000-0000-4000-8000-00000000000e'; // Akademia Górnicza: teacher1 is not a member

describe('teacher dashboard RPCs (#654)', () => {
  let teacher: SupabaseClient;

  beforeAll(async () => {
    teacher = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await teacher.auth.signInWithPassword({
      email: 'teacher1@dev.local',
      password: 'pass',
    });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  });

  it.each(['get_teacher_group_performance', 'get_teacher_activity_feed'])(
    "%s answers a list for the caller's own organization",
    async (fn) => {
      const { data, error } = await teacher.rpc(fn, {
        p_user_id: TEACHER_ID,
        p_organization_id: ORG,
      });
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    },
  );

  it('lists only groups the caller belongs to, with numbers in range', async () => {
    const { data } = await teacher.rpc('get_teacher_group_performance', {
      p_user_id: TEACHER_ID,
      p_organization_id: ORG,
    });
    for (const group of data as Array<Record<string, number | null | string>>) {
      expect(typeof group.groupName).toBe('string');
      expect(group.students as number).toBeGreaterThanOrEqual(0);
      for (const key of ['avgScore', 'flashcardAccuracy'] as const) {
        const value = group[key] as number | null;
        if (value !== null) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it.each(['get_teacher_group_performance', 'get_teacher_activity_feed'])(
    '%s refuses to run for another user (42501)',
    async (fn) => {
      const { error } = await teacher.rpc(fn, {
        p_user_id: OTHER_USER_ID,
        p_organization_id: ORG,
      });
      expect(error?.code).toBe('42501');
    },
  );

  it.each(['get_teacher_group_performance', 'get_teacher_activity_feed'])(
    '%s returns nothing for an organization the caller is not in',
    async (fn) => {
      const { data, error } = await teacher.rpc(fn, {
        p_user_id: TEACHER_ID,
        p_organization_id: FOREIGN_ORG,
      });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    },
  );
});
