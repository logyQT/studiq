import type { NextRequest } from 'next/server';
import { POST as registerPost } from '@/app/(backend)/api/v1/auth/register/route';
import { POST as createDeckPost } from '@/app/(backend)/api/v1/flashcards/decks/route';
import { POST as createFlashcardPost } from '@/app/(backend)/api/v1/flashcards/route';
import { POST as createTopicPost } from '@/app/(backend)/api/v1/flashcards/topics/route';
import {
  PUT as setGroupMembersPut,
} from '@/app/(backend)/api/v1/organization/groups/[id]/members/route';
import { POST as createGroupPost } from '@/app/(backend)/api/v1/organization/groups/route';
import { POST as acceptInvitePost } from '@/app/(backend)/api/v1/organization/invites/accept/route';
import { POST as createInvitePost } from '@/app/(backend)/api/v1/organization/invites/route';
import { POST as createOrgPost } from '@/app/(backend)/api/v1/organization/route';
import { POST as createQuestionPost } from '@/app/(backend)/api/v1/questions/route';
import { POST as createBankPost } from '@/app/(backend)/api/v1/questions/banks/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as createQuizPost } from '@/app/(backend)/api/v1/teacher/quizzes/route';
import { createServiceClient, mockUser, useRealSupabase } from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

// ============================================================
// API-first test seeding
// Creates users, organizations, members and content through the
// real API routes (register → org → invites → groups → content).
// DB (service-role) access is limited to idempotency checks,
// email confirmation and fallbacks for endpoints with no route yet.
// ============================================================

export type CreateTestUserRole = 'student' | 'educator' | 'manager';

export interface CreateTestUserOptions {
  role: CreateTestUserRole;
  email?: string;
  name?: string;
  password?: string;
}

export interface TestUserFixture {
  id: string;
  email: string;
  role: CreateTestUserRole;
}

export interface SeedProfile {
  role: CreateTestUserRole;
  email?: string;
  org?: boolean | string;
  members?: { count: number };
  groups?: number;
  topics?: number;
  decks?: number;
  flashcards?: number;
  questions?: number;
  quizzes?: number;
  assignment?: boolean;
}

export interface BeforeResult {
  user: TestUserFixture;
  email: string;
  orgId: string | null;
  defaultGroupId: string | null;
  groups: string[];
  memberUsers: TestUserFixture[];
  created: {
    topics: string[];
    decks: string[];
    flashcards: string[];
    questions: string[];
    quizzes: string[];
    assignmentId: string | null;
  };
}

const BASE_URL = 'http://localhost';

function randomTag(length = 8): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < length; i++) out += hex[Math.floor(Math.random() * 16)];
  return out;
}

function randomLetters(length = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * 26)];
  return out;
}

function assertSuccess<T>(res: Response, body: { success?: boolean; data?: T }, label: string): T {
  if (!res.ok || body.success === false) {
    throw new Error(`[seed] ${label} failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.data as T;
}

class SeedApiError extends Error {
  constructor(
    readonly label: string,
    readonly status: number,
    readonly body: { error?: string },
  ) {
    super(`[seed] ${label} failed (${status}): ${JSON.stringify(body)}`);
  }
}

async function api<T>(
  label: string,
  route: (req: NextRequest) => Promise<Response>,
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  init: { body?: unknown } = {},
  cookies?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const req = createNextRequest(
    `${BASE_URL}${url}`,
    {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    },
    cookies,
  );
  const res = await route(req);
  const body = await res.json();
  if (!res.ok || body.success === false) {
    throw new SeedApiError(label, res.status, body);
  }
  return body.data as T;
}

// ============================================================
// createTestUser — idempotent, real register API + email confirm
// ============================================================
export async function createTestUser(opts: CreateTestUserOptions): Promise<TestUserFixture> {
  const email = opts.email ?? `seed-${opts.role}-${randomTag()}@dev.local`;
  const password = opts.password ?? 'Seed4Test!';
  const name = opts.name ?? `Seed ${opts.role} ${randomLetters()}`;

  const service = createServiceClient();

  const { data: existing } = await service
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existing) {
    return { id: existing.id, email, role: opts.role };
  }

  useRealSupabase();
  await api(
    'register',
    registerPost,
    '/api/v1/auth/register',
    'POST',
    { body: { name, email, password, accountType: opts.role } },
  );

  const { data: profile, error } = await service
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();
  if (error || !profile) {
    throw new Error(`[seed] profile not created for ${email}: ${error?.message}`);
  }

  const { error: confirmError } = await service.auth.admin.updateUserById(profile.id, {
    email_confirm: true,
  });
  if (confirmError) {
    throw new Error(`[seed] failed to confirm email for ${email}: ${confirmError.message}`);
  }

  return { id: profile.id, email, role: opts.role };
}

// ============================================================
// seedViaApi — org, members (invite+accept), groups, content
// ============================================================
export async function seedViaApi(
  user: TestUserFixture,
  profile: Omit<SeedProfile, 'role'>,
): Promise<BeforeResult> {
  const service = createServiceClient();
  const tags = `${user.email.split('@')[0]}-${randomTag(4)}`;
  const cookie = profile.org ? { active_org_id: '' } : undefined;

  let orgId: string | null = null;
  let defaultGroupId: string | null = null;
  const groups: string[] = [];
  const memberUsers: TestUserFixture[] = [];
  const created = {
    topics: [],
    decks: [],
    flashcards: [],
    questions: [],
    quizzes: [],
    assignmentId: null as string | null,
  };

  mockUser(user);

  const wantsOrg = !!profile.org && user.role !== 'student';
  if (wantsOrg) {
    const orgName = typeof profile.org === 'string' ? profile.org : `seed-org-${tags}`;
    const org = await api<{ id: string }>(
      'create-organization',
      createOrgPost,
      '/api/v1/organization',
      'POST',
      { body: { name: orgName } },
    );
    orgId = org.id;
  }

  if (orgId) {
    cookie!.active_org_id = orgId;

    const { data: defaultGroup } = await service
      .from('groups')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_default', true)
      .maybeSingle();
    defaultGroupId = defaultGroup?.id ?? null;
  }

  // Extra groups via API.
  const extraGroups = profile.groups ?? 0;
  if (orgId) {
    for (let i = 0; i < extraGroups; i++) {
      const group = await api<{ id: string }>(
        'create-group',
        createGroupPost,
        '/api/v1/organization/groups',
        'POST',
        { body: { name: `seed-group-${tags}-${i}` } },
        cookie,
      );
      groups.push(group.id);
    }
    if (defaultGroupId) groups.unshift(defaultGroupId);
  }

  // Members via invite → accept → (optionally) group membership.
  const memberCount = profile.members?.count ?? 0;
  if (orgId && memberCount > 0) {
    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    if (!memberRole) throw new Error('[seed] member org role not found');

    for (let i = 0; i < memberCount; i++) {
      const member = await createTestUser({ role: 'student' });

      mockUser(user);
      await api(
        'create-invite',
        createInvitePost,
        '/api/v1/organization/invites',
        'POST',
        { body: { email: member.email, targetOrgRoleId: memberRole.id } },
        cookie,
      );

      const { data: invite } = await service
        .from('invitations')
        .select('token')
        .eq('email', member.email)
        .eq('organization_id', orgId)
        .order('expires_at', { ascending: false })
        .limit(1)
        .single();
      if (!invite) throw new Error(`[seed] invite token not found for ${member.email}`);

      mockUser(member);
      await api(
        'accept-invite',
        acceptInvitePost,
        '/api/v1/organization/invites/accept',
        'POST',
        { body: { token: invite.token } },
      );

      if (defaultGroupId) {
        mockUser(user);
        await api(
          'add-to-group',
          (req) => setGroupMembersPut(req, { params: Promise.resolve({ id: defaultGroupId }) }),
          `/api/v1/organization/groups/${defaultGroupId}/members`,
          'PUT',
          { body: { members: [{ userId: member.id, role: 'member' }] } },
          cookie,
        );
      }

      memberUsers.push(member);
    }
  }

  mockUser(user);

  // Topics via API.
  const topicCount = profile.topics ?? 0;
  for (let i = 0; i < topicCount; i++) {
    const topic = await api<{ id: string }>(
      'create-topic',
      createTopicPost,
      '/api/v1/flashcards/topics',
      'POST',
      { body: { name: `seed-topic-${tags}-${i}` } },
      cookie,
    );
    created.topics.push(topic.id);
  }

  // Decks via API.
  const deckCount = profile.decks ?? 0;
  for (let i = 0; i < deckCount; i++) {
    const deck = await api<{ id: string }>(
      'create-deck',
      createDeckPost,
      '/api/v1/flashcards/decks',
      'POST',
      { body: { name: `seed-deck-${tags}-${i}` } },
      cookie,
    );
    created.decks.push(deck.id);
  }

  // Flashcards via API.
  const flashcardCount = profile.flashcards ?? 0;
  for (let i = 0; i < flashcardCount; i++) {
    const deckId = created.decks[i % Math.max(created.decks.length, 1)] ?? undefined;
    await api(
      'create-flashcard',
      createFlashcardPost,
      '/api/v1/flashcards',
      'POST',
      {
        body: {
          front: `seed-flashcard-front-${tags}-${i}`,
          back: `seed-flashcard-back-${tags}-${i}`,
          ...(deckId ? { deckId } : {}),
        },
      },
      cookie,
    ).then((card: { id?: string }) => {
      if (card.id) created.flashcards.push(card.id);
    });
  }

  // Questions via API (bank created via the question-banks API).
  // Works with or without an org — without an org the bank/questions land
  // in the user's personal scope (organization_id = null), matching the
  // legacy service-role seeding used by quiz/attempt suites.
  const questionCount = profile.questions ?? 0;
  if (questionCount > 0) {
    const bank = await api<{ id: string }>(
      'create-question-bank',
      createBankPost,
      '/api/v1/questions/banks',
      'POST',
      {
        body: {
          name: `seed-bank-${tags}`,
          ...(orgId ? { visibility: 'group' } : {}),
        },
      },
      cookie,
    );

    for (let i = 0; i < questionCount; i++) {
      const question = await api<{ id: string }>(
        'create-question',
        createQuestionPost,
        '/api/v1/questions',
        'POST',
        {
          body: {
            bankId: bank.id,
            type: 'mcq',
            content: `seed-question-${tags}-${i}`,
            answers: [
              { content: `answer-a-${i}`, isCorrect: true, orderIndex: 0 },
              { content: `answer-b-${i}`, isCorrect: false, orderIndex: 1 },
              { content: `answer-c-${i}`, isCorrect: false, orderIndex: 2 },
            ],
          },
        },
        cookie,
      );
      created.questions.push(question.id);
    }
  }

  // Quizzes + assignment via API (educator-only routes).
  if (user.role === 'educator') {
    const quizCount = profile.quizzes ?? 0;
    for (let i = 0; i < quizCount; i++) {
      const quiz = await api<{ id: string }>(
        'create-quiz',
        createQuizPost,
        '/api/v1/teacher/quizzes',
        'POST',
        { body: { name: `seed-quiz-${tags}-${i}` } },
        cookie,
      );
      created.quizzes.push(quiz.id);
    }

    if (profile.assignment) {
      const quizId = created.quizzes[0];
      const assignment = await api<{ id: string }>(
        'create-assignment',
        createAssignmentPost,
        '/api/v1/teacher/assignments',
        'POST',
        {
          body: {
            title: `seed-assignment-${tags}`,
            ...(quizId ? { quizId } : {}),
          },
        },
        cookie,
      );
      created.assignmentId = assignment.id;
    }
  }

  return {
    user,
    email: user.email,
    orgId,
    defaultGroupId,
    groups,
    memberUsers,
    created,
  };
}

// ============================================================
// before — one-call orchestrator for API-driven test setup
// ============================================================
export async function before(profile: SeedProfile): Promise<BeforeResult> {
  const user = await createTestUser({ role: profile.role, email: profile.email });
  return seedViaApi(user, profile);
}

export { randomTag };