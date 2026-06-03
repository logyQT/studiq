import { vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import * as supabaseModule from '@/lib/supabase/server';

// ============================================================
// Test User Constants (from supabase/seeds/01_users.sql)
// Password for all accounts: 'pass'
// ============================================================
export const TEST_USERS = {
  SYS_ADMIN: {
    id: '00000000-0000-4000-8001-000000000001',
    email: 'admin@dev.local',
    password: 'pass',
    role: 'sys_admin',
  },
  UNIVERSITY_ADMIN: {
    id: '00000000-0000-4000-8001-000000000002',
    email: 'uadmin@dev.local',
    password: 'pass',
    role: 'university_admin',
  },
  TEACHER: {
    id: '00000000-0000-4000-8001-000000000003',
    email: 'teacher@dev.local',
    password: 'pass',
    role: 'teacher',
  },
  STUDENT: {
    id: '00000000-0000-4000-8001-000000000004',
    email: 'student@dev.local',
    password: 'pass',
    role: 'student',
  },
  PREMIUM: {
    id: '00000000-0000-4000-8001-000000000005',
    email: 'premium@dev.local',
    password: 'pass',
    role: 'premium',
  },
  FREE: {
    id: '00000000-0000-4000-8001-000000000006',
    email: 'user@dev.local',
    password: 'pass',
    role: 'free',
  },
} as const;

export const TEST_UNIVERSITY_ID = '00000000-0000-4000-8000-000000000001';

// ============================================================
// Real Supabase Client (bypasses the global mock)
// ============================================================
export function createRealClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // no-op for tests
        },
      },
    },
  );
}

// ============================================================
// Service Role Client (bypasses RLS for seeding/cleanup)
// ============================================================
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// ============================================================
// Use Real Supabase (for integration tests that need full DB access)
// Overrides the global mock with an unmodified real Supabase client.
// Use this for auth endpoints (register, login, etc.) that don't
// require a mocked auth identity.
// ============================================================
export function useRealSupabase() {
  vi.mocked(supabaseModule.createClient).mockImplementation(async () => {
    return createRealClient();
  });
}

// ============================================================
// Auth Mocking
// Combines mocked getUser() with real Supabase DB operations
// ============================================================
export function mockUser(user: { id: string; role: string } | null) {
  const mockUserObj = user
    ? {
        id: user.id,
        email: 'test@test.com',
        app_metadata: { role: user.role },
        user_metadata: {},
        aud: 'authenticated' as const,
        created_at: new Date().toISOString(),
      }
    : null;

  vi.mocked(supabaseModule.createClient).mockImplementation(async () => {
    const realClient = createRealClient();
    realClient.auth.getUser = async () => ({ data: { user: mockUserObj as any }, error: null });
    return realClient;
  });
}

// ============================================================
// Cleanup Functions (use service role client to bypass RLS)
// ============================================================
export async function cleanupSubjects(userId: string, namePrefix?: string) {
  const supabase = createServiceClient();
  let query = supabase.from('subjects').delete().eq('created_by', userId);
  if (namePrefix) {
    query = query.ilike('name', `${namePrefix}%`);
  }
  await query;
}

export async function cleanupQuestions(userId: string, contentPrefix?: string) {
  const supabase = createServiceClient();
  let query = supabase.from('questions').select('id').eq('created_by', userId);
  if (contentPrefix) {
    query = query.ilike('content', `${contentPrefix}%`);
  }
  const { data: questions } = await query;

  if (questions && questions.length > 0) {
    const questionIds = questions.map((q) => q.id);
    await supabase.from('question_answers').delete().in('question_id', questionIds);
    await supabase.from('questions').delete().in('id', questionIds);
  }
}

export async function cleanupFlashcards(userId: string, frontPrefix?: string) {
  const supabase = createServiceClient();
  let query = supabase.from('flashcards').select('id').eq('created_by', userId);
  if (frontPrefix) {
    query = query.ilike('front', `${frontPrefix}%`);
  }
  const { data: flashcards } = await query;

  if (flashcards && flashcards.length > 0) {
    const flashcardIds = flashcards.map((f) => f.id);
    await supabase.from('flashcard_topic_assignments').delete().in('flashcard_id', flashcardIds);
    await supabase.from('flashcard_space_assignments').delete().in('flashcard_id', flashcardIds);
    await supabase.from('flashcard_practice').delete().in('flashcard_id', flashcardIds);
    await supabase.from('flashcards').delete().in('id', flashcardIds);
  }
}

export async function cleanupFlashcardTopics(userId: string, namePrefix?: string) {
  const supabase = createServiceClient();
  let query = supabase.from('flashcard_topics').delete().eq('created_by', userId);
  if (namePrefix) {
    query = query.ilike('name', `${namePrefix}%`);
  }
  await query;
}

export async function cleanupFlashcardSpaces(userId: string, namePrefix?: string) {
  const supabase = createServiceClient();
  let query = supabase.from('flashcard_spaces').delete().eq('created_by', userId);
  if (namePrefix) {
    query = query.ilike('name', `${namePrefix}%`);
  }
  await query;
}

export async function cleanupFlashcardPractice(userId: string) {
  const supabase = createServiceClient();
  await supabase.from('flashcard_practice').delete().eq('user_id', userId);
}

export async function cleanupFlashcardReviewState(userId: string) {
  const supabase = createServiceClient();
  await supabase.from('flashcard_review_state').delete().eq('user_id', userId);
}

export async function cleanupQuizAttempts(userId: string) {
  const supabase = createServiceClient();
  const { data: attempts } = await supabase
    .from('quiz_attempts')
    .select('id')
    .eq('user_id', userId);

  if (attempts && attempts.length > 0) {
    const attemptIds = attempts.map((a) => a.id);
    await supabase.from('quiz_answers').delete().in('attempt_id', attemptIds);
    await supabase.from('quiz_attempt_questions').delete().in('attempt_id', attemptIds);
    await supabase.from('quiz_attempts').delete().eq('user_id', userId);
  }
}

export async function cleanupInvitations(userId: string) {
  const supabase = createServiceClient();
  await supabase.from('invitations').delete().eq('inviter_id', userId);
}

export async function cleanupUniversity(slugPrefix?: string) {
  const supabase = createServiceClient();
  let query = supabase.from('universities').delete();
  if (slugPrefix) {
    query = query.ilike('slug', `${slugPrefix}%`);
  } else {
    query = query.neq('id', '00000000-0000-4000-8000-000000000001');
  }
  await query;
}

// ============================================================
// Seed Functions (use service role client to bypass RLS)
// ============================================================
export async function seedSubject(data: {
  name: string;
  created_by: string;
  university_id?: string;
}) {
  const supabase = createServiceClient();
  const { data: subject, error } = await supabase
    .from('subjects')
    .insert({
      name: data.name,
      created_by: data.created_by,
      university_id: data.university_id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return subject;
}

export async function seedQuestion(data: {
  type: string;
  content: string;
  difficulty: string;
  created_by: string;
  subject_id?: string;
}) {
  const supabase = createServiceClient();
  const { data: question, error } = await supabase
    .from('questions')
    .insert({
      type: data.type,
      content: data.content,
      difficulty: data.difficulty,
      created_by: data.created_by,
      subject_id: data.subject_id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return question;
}

export async function seedFlashcard(data: { front: string; back: string; created_by: string }) {
  const supabase = createServiceClient();
  const { data: fc, error } = await supabase
    .from('flashcards')
    .insert({ front: data.front, back: data.back, created_by: data.created_by })
    .select()
    .single();
  if (error) throw error;
  return fc;
}

export async function seedTopic(data: { name: string; created_by: string }) {
  const supabase = createServiceClient();
  const { data: topic, error } = await supabase
    .from('flashcard_topics')
    .insert({ name: data.name, created_by: data.created_by })
    .select()
    .single();
  if (error) throw error;
  return topic;
}

export async function seedSpace(data: { name: string; created_by: string }) {
  const supabase = createServiceClient();
  const { data: space, error } = await supabase
    .from('flashcard_spaces')
    .insert({ name: data.name, created_by: data.created_by })
    .select()
    .single();
  if (error) throw error;
  return space;
}

// ============================================================
// Bulk Cleanup for all test users
// ============================================================
export async function cleanupAll() {
  const userIds = Object.values(TEST_USERS).map((u) => u.id);
  for (const userId of userIds) {
    await cleanupSubjects(userId);
    await cleanupQuestions(userId);
    await cleanupFlashcards(userId);
    await cleanupFlashcardTopics(userId);
    await cleanupFlashcardSpaces(userId);
    await cleanupFlashcardPractice(userId);
    await cleanupQuizAttempts(userId);
    await cleanupInvitations(userId);
  }
}
