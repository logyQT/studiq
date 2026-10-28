import type { NextRequest } from 'next/server';
import { mockUser } from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import {
  buildAccount,
  createSeedDb,
  ensureAccount,
  randomTag,
  seedTenantGraph,
  tenantId,
} from '#test/helpers/tenant-seed';
import { POST as createDeckPost } from '@/app/(backend)/api/v1/flashcards/decks/route';
import { POST as createFlashcardPost } from '@/app/(backend)/api/v1/flashcards/route';
import { POST as createTopicPost } from '@/app/(backend)/api/v1/flashcards/topics/route';
import { POST as createQuestionPost } from '@/app/(backend)/api/v1/questions/route';
import { POST as createBankPost } from '@/app/(backend)/api/v1/questions/banks/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as createQuizPost } from '@/app/(backend)/api/v1/teacher/quizzes/route';

// ============================================================
// Test fixtures built on the shared tenant seeder
// (__tests__/helpers/tenant-seed.ts, also used by scripts/e2e-seed.ts).
//
// The seeder owns accounts, organizations, roles, the default group and
// memberships. Content (topics/decks/flashcards/questions/quizzes/assignments)
// is still created through the real API routes so those flows stay covered.
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
  /** Present for accounts created through `createTestUser` (API login fixtures). */
  password?: string;
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

function randomLetters(length = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * 26)];
  return out;
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
// createTestUser — idempotent; account rows come from the shared seeder
// ============================================================
export async function createTestUser(opts: CreateTestUserOptions): Promise<TestUserFixture> {
  const email = opts.email ?? `seed-${opts.role}-${randomTag()}@dev.local`;
  const password = opts.password ?? 'Seed4Test!';
  const name = opts.name ?? `Seed ${opts.role} ${randomLetters()}`;

  const account = buildAccount(`user:${crypto.randomUUID()}`, 'user', opts.role, {
    email,
    password,
    name,
  });
  const seeded = await ensureAccount(createSeedDb(), account);
  return {
    id: seeded.id,
    email: seeded.email,
    role: seeded.role,
    password: seeded.password,
  };
}

// ============================================================
// seedViaApi — tenant graph from the seeder, content via the API
// ============================================================
export async function seedViaApi(
  user: TestUserFixture,
  profile: Omit<SeedProfile, 'role'>,
): Promise<BeforeResult> {
  const tags = `${user.email.split('@')[0]}-${randomTag(4)}`;
  const key = `fixture:${crypto.randomUUID()}`;
  const cookie = profile.org ? { active_org_id: '' } : undefined;

  const wantsOrg = !!profile.org && user.role !== 'student';
  const orgName =
    wantsOrg && profile.org
      ? typeof profile.org === 'string'
        ? profile.org
        : `seed-org-${tags}`
      : null;

  const memberCount = wantsOrg ? (profile.members?.count ?? 0) : 0;
  const extraGroupCount = wantsOrg ? (profile.groups ?? 0) : 0;
  const members = Array.from({ length: memberCount }, (_, index) =>
    buildAccount(key, `member:${index}`, 'student'),
  );
  const extraGroups = Array.from({ length: extraGroupCount }, (_, index) => ({
    id: tenantId(key, `group:${index}`),
    name: `seed-group-${tags}-${index}`,
    isDefault: false,
  }));

  const graph = await seedTenantGraph(createSeedDb(), {
    key,
    org: orgName ? { id: tenantId(key, 'org'), name: orgName } : null,
    defaultGroup: orgName
      ? { id: tenantId(key, 'group:default'), name: 'Członkowie', isDefault: true }
      : null,
    extraGroups,
    owner: {
      id: user.id,
      email: user.email,
      password: 'Seed4Test!',
      role: user.role,
      accountType: user.role,
      name: user.email,
    },
    members,
    ownerOrgRole: 'admin',
  });

  const orgId = graph.orgId;
  const defaultGroupId = graph.defaultGroupId;
  const groups = graph.groups.map((group) => group.id);
  const memberUsers: TestUserFixture[] = graph.members.map((member) => ({
    id: member.id,
    email: member.email,
    role: member.role,
    password: member.password,
  }));

  if (orgId) {
    cookie!.active_org_id = orgId;
  }

  const created = {
    topics: [] as string[],
    decks: [] as string[],
    flashcards: [] as string[],
    questions: [] as string[],
    quizzes: [] as string[],
    assignmentId: null as string | null,
  };

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
// before — one-call orchestrator for test setup
// ============================================================
export async function before(profile: SeedProfile): Promise<BeforeResult> {
  const user = await createTestUser({ role: profile.role, email: profile.email });
  return seedViaApi(user, profile);
}

export { randomTag };
