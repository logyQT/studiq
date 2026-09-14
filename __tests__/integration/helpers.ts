import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
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
    email: 'manager@dev.local',
    password: 'pass',
    role: 'manager',
  },
  TEACHER: {
    id: '00000000-0000-4000-8001-000000000003',
    email: 'teacher1@dev.local',
    password: 'pass',
    role: 'educator',
  },
  STUDENT: {
    id: '00000000-0000-4000-8001-000000000009',
    email: 'test-student@dev.local',
    password: 'pass',
    role: 'student',
  },
  STUDENT2: {
    id: '00000000-0000-4000-8001-000000000005',
    email: 'student2@dev.local',
    password: 'pass',
    role: 'student',
  },
  STUDENT3: {
    id: '00000000-0000-4000-8001-000000000006',
    email: 'student3@dev.local',
    password: 'pass',
    role: 'student',
  },
} as const;

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
// Combines mocked getUser() with real Supabase DB operations (app_metadata uses account_type)
// ============================================================
export function mockUser(user: { id: string; role: string } | null) {
  const mockUserObj = user
    ? {
        id: user.id,
        email: 'test@test.com',
        app_metadata: { account_type: user.role },
        user_metadata: {},
        aud: 'authenticated' as const,
        created_at: new Date().toISOString(),
      }
    : null;

  vi.mocked(supabaseModule.createClient).mockImplementation(async () => {
    // Use service_role client to bypass RLS — services use explicit permission
    // checks (eq 'created_by', etc.) instead of relying on RLS.
    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    serviceClient.auth.getUser = async () => ({ data: { user: mockUserObj as any }, error: null });
    return serviceClient;
  });
}

// ============================================================
// Organization seeding & cleanup
// ============================================================

/** Creates a fresh org, default roles, default group. Returns IDs. */
export async function seedOrganization(name: string) {
  const supabase = createServiceClient();

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({ name })
    .select()
    .single();
  if (error || !org) throw new Error(`Failed to create org: ${error?.message}`);

  // Trigger handle_new_organization already created roles — query them
  const { data: roles } = await supabase
    .from('org_roles')
    .select('id, name')
    .eq('organization_id', org.id);
  if (!roles || roles.length < 3) throw new Error('Trigger did not create default roles');

  const roleIds: Record<string, string> = {};
  for (const r of roles) {
    roleIds[r.name] = r.id;
  }

  const { data: group } = await supabase
    .from('groups')
    .insert({ organization_id: org.id, name: 'Członkowie', description: null, is_default: true })
    .select('id')
    .single();
  if (!group) throw new Error('Failed to create default group');

  return {
    org,
    adminRoleId: roleIds.admin,
    teacherRoleId: roleIds.teacher,
    memberRoleId: roleIds.member,
    defaultGroupId: group.id,
  };
}

/** Adds or updates an org membership for a user. */
export async function seedOrgMembership(data: {
  organizationId: string;
  userId: string;
  orgRoleId: string;
}) {
  const supabase = createServiceClient();
  const { error } = await supabase.from('org_members').upsert(
    {
      organization_id: data.organizationId,
      user_id: data.userId,
      org_role_id: data.orgRoleId,
    },
    { onConflict: 'organization_id,user_id' },
  );
  if (error) throw new Error(`Failed to create org membership: ${error.message}`);
}

export async function seedGroupMembership(data: {
  groupId: string;
  userId: string;
  role: string;
}) {
  const supabase = createServiceClient();
  const { error } = await supabase.from('group_members').upsert(
    {
      group_id: data.groupId,
      user_id: data.userId,
      role: data.role,
    },
    { onConflict: 'group_id,user_id' },
  );
  if (error) throw new Error(`Failed to create group membership: ${error.message}`);
}

/** Deep-clean an org: deletes all related rows + the org itself. */
export async function cleanupOrganizationDeep(orgId: string) {
  const supabase = createServiceClient();
  const roleIds = (await supabase.from('org_roles').select('id').eq('organization_id', orgId)).data?.map(r => r.id) ?? [];

  await supabase.from('org_seat_assignments').delete().eq('organization_id', orgId);
  await supabase.from('org_seat_pools').delete().eq('organization_id', orgId);
  await supabase.from('org_members').delete().eq('organization_id', orgId);
  await supabase.from('group_members').delete().in('group_id', (await supabase.from('groups').select('id').eq('organization_id', orgId)).data?.map(g => g.id) ?? []);
  await supabase.from('groups').delete().eq('organization_id', orgId);
  if (roleIds.length > 0) {
    await supabase.from('org_role_features').delete().in('org_role_id', roleIds);
    await supabase.from('org_role_permissions').delete().in('org_role_id', roleIds);
  }
  await supabase.from('org_roles').delete().eq('organization_id', orgId);
  await supabase.from('org_limits').delete().eq('organization_id', orgId);
  await supabase.from('organizations').delete().eq('id', orgId);
}

/** Cleanup orgs created during tests by name prefix. */
export async function cleanupOrganizationByName(namePrefix: string) {
  const supabase = createServiceClient();
  const { data: orgs } = await supabase.from('organizations').select('id').ilike('name', `${namePrefix}%`);
  for (const org of orgs ?? []) {
    await cleanupOrganizationDeep(org.id);
  }
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

  // Clean banks created implicitly by seedQuestion (DB-fallback bridge).
  await supabase
    .from('question_banks')
    .delete()
    .eq('created_by', userId)
    .ilike('name', 'seed-bank-%');
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
    // flashcard_deck_assignments table removed — deck_id is a direct FK on flashcards
    await supabase.from('flashcard_practice').delete().in('flashcard_id', flashcardIds);
    await supabase.from('flashcards').delete().in('id', flashcardIds);
  }
}

export async function cleanupFlashcardTopics(userId: string, namePrefix?: string) {
  const supabase = createServiceClient();
  let query = supabase.from('topics').delete().eq('created_by', userId);
  if (namePrefix) {
    query = query.ilike('name', `${namePrefix}%`);
  }
  await query;
}

export async function cleanupFlashcardDecks(userId: string, namePrefix?: string) {
  const supabase = createServiceClient();
  let query = supabase.from('flashcard_decks').delete().eq('created_by', userId);
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

// ============================================================
// Seed Functions (use service role client to bypass RLS)
// ============================================================
export async function seedSubject(data: {
  name: string;
  created_by: string;
  organization_id?: string;
}) {
  const supabase = createServiceClient();
  const { data: subject, error } = await supabase
    .from('subjects')
    .insert({
      name: data.name,
      created_by: data.created_by,
      organization_id: data.organization_id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return subject;
}

/** DB fallback bridge: questions.bank_id is NOT NULL, so create a bank on the fly. */
export async function seedQuestion(data: {
  type: string;
  content: string;
  created_by: string;
  organization_id?: string;
  bank_id?: string;
}) {
  const supabase = createServiceClient();

  let bankId = data.bank_id;
  if (!bankId) {
    const { data: bank, error: bankError } = await supabase
      .from('question_banks')
      .insert({
        name: `seed-bank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        created_by: data.created_by,
        organization_id: data.organization_id ?? null,
        visibility: data.organization_id ? 'group' : 'personal',
      })
      .select('id')
      .single();
    if (bankError || !bank) {
      throw bankError ?? new Error('Failed to create question bank');
    }
    bankId = bank.id;
  }

  const { data: question, error } = await supabase
    .from('questions')
    .insert({
      type: data.type,
      content: data.content,
      created_by: data.created_by,
      organization_id: data.organization_id ?? null,
      bank_id: bankId,
    })
    .select()
    .single();
  if (error) throw error;
  return question;
}

/** DB fallback bridge: flashcards.deck_id is NOT NULL, so create a deck on the fly. */
export async function seedFlashcard(data: {
  front: string;
  back: string;
  created_by: string;
  deck_id?: string;
}) {
  const supabase = createServiceClient();

  let deckId = data.deck_id;
  if (!deckId) {
    const { data: deck, error: deckError } = await supabase
      .from('flashcard_decks')
      .insert({
        name: `seed-deck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        created_by: data.created_by,
      })
      .select('id')
      .single();
    if (deckError || !deck) {
      throw deckError ?? new Error('Failed to create flashcard deck');
    }
    deckId = deck.id;
  }

  const { data: fc, error } = await supabase
    .from('flashcards')
    .insert({ front: data.front, back: data.back, created_by: data.created_by, deck_id: deckId })
    .select()
    .single();
  if (error) throw error;
  return fc;
}

export async function seedTopic(data: { name: string; created_by: string }) {
  const supabase = createServiceClient();
  const { data: topic, error } = await supabase
    .from('topics')
    .insert({ name: data.name, created_by: data.created_by })
    .select()
    .single();
  if (error) throw error;
  return topic;
}

export async function seedDeck(data: { name: string; created_by: string }) {
  const supabase = createServiceClient();
  const { data: deck, error } = await supabase
    .from('flashcard_decks')
    .insert({ name: data.name, created_by: data.created_by })
    .select()
    .single();
  if (error) throw error;
  return deck;
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
    await cleanupFlashcardDecks(userId);
    await cleanupFlashcardPractice(userId);
    await cleanupQuizAttempts(userId);
    await cleanupInvitations(userId);
  }
}
