import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// #664: notifications are private to their recipient, and only the service role writes them. Real
// seed users sign in with the anon key, the path a browser takes.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const STUDENT_ID = '00000000-0000-4000-8001-000000000005'; // student1@dev.local
const MARKER = `rls-test-${Date.now()}`;

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: 'pass' });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

describe('notifications access (#664)', () => {
  const service = createServiceClient();
  let student: SupabaseClient;
  let teacher: SupabaseClient;
  let notificationId: string;

  beforeAll(async () => {
    [student, teacher] = await Promise.all([
      signIn('student1@dev.local'),
      signIn('teacher1@dev.local'),
    ]);
    const { data, error } = await service
      .from('notifications')
      .insert({ user_id: STUDENT_ID, type: 'assignment_graded', payload: { title: MARKER } })
      .select('id')
      .single();
    if (error) throw error;
    notificationId = data.id;
  });

  afterAll(async () => {
    await service.from('notifications').delete().eq('payload->>title', MARKER);
  });

  it('lets the recipient read their own notification', async () => {
    const { data, error } = await student
      .from('notifications')
      .select('id, type')
      .eq('id', notificationId);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: notificationId, type: 'assignment_graded' }]);
  });

  it("hides it from everyone else, even a teacher of the student's group", async () => {
    const { data, error } = await teacher
      .from('notifications')
      .select('id')
      .eq('id', notificationId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('lets nobody write through the API: insert, update and delete are refused', async () => {
    const insert = await student
      .from('notifications')
      .insert({ user_id: STUDENT_ID, type: 'assignment_graded', payload: { title: MARKER } });
    const forged = await teacher
      .from('notifications')
      .insert({ user_id: STUDENT_ID, type: 'assignment_published', payload: { title: MARKER } });
    const update = await student
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId);
    const remove = await student.from('notifications').delete().eq('id', notificationId);

    for (const result of [insert, forged, update, remove]) expect(result.error?.code).toBe('42501');

    const { data } = await service
      .from('notifications')
      .select('read_at')
      .eq('id', notificationId)
      .single();
    expect(data?.read_at).toBeNull();
  });

  it('only accepts the four known kinds', async () => {
    const { error } = await service
      .from('notifications')
      .insert({ user_id: STUDENT_ID, type: 'made_up', payload: { title: MARKER } });

    expect(error?.code).toBe('23514');
  });
});
