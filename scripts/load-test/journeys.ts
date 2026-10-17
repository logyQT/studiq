/**
 * Weighted bot actions ("journeys") grouped by account type.
 *
 * A journey is a set of named actions with relative weights. `bots.ts` picks a
 * role-appropriate action each tick, weighted, so the generated traffic mirrors
 * how real students browse/practice and how educators/managers scan dashboards.
 *
 * Read actions dominate on purpose — students mostly read; writes (create deck,
 * create cards, log a review) are sprinkled in so the database sees real
 * mutation + row-level-security paths too.
 */

import {
  type AccountRecord,
  type ApiResult,
  AppClient,
  extractItems,
  idOf,
  pick,
  randInt,
} from './config';

export interface BotState {
  client: AppClient;
  account: AccountRecord;
  rng: () => number;
  /** Deck ids this bot has seen/created — reused by follow-up actions. */
  deckIds: string[];
  topicIds: string[];
  cardIds: string[];
  lastDeckId: string | null;
}

export interface Action {
  name: string;
  weight: number;
  /** When false, the action is skipped for this tick (e.g. needs a known deck id). */
  available?: (state: BotState) => boolean;
  run: (state: BotState) => Promise<ApiResult | ApiResult[]>;
}

const SEARCH_TERMS = [
  'cell',
  'dna',
  'photosynthesis',
  'mitosis',
  'derivative',
  'integral',
  'gravity',
  'atom',
  'neuron',
  'enzyme',
  'algorithm',
  'recursion',
  'inflation',
  'revolution',
  'protein',
  'thermodynamics',
];

const FRONT_TEMPLATES = [
  (n: string) => `Define ${n}`,
  (n: string) => `What is the role of ${n}?`,
  (n: string) => `Give an example of ${n}`,
  (n: string) => `Why does ${n} matter?`,
];

const BACK_TEMPLATES = [
  (n: string) => `${n} is a core concept covered in the lecture slides.`,
  (n: string) => `A concise definition of ${n}, with one worked example.`,
  (n: string) => `Key properties and common misconceptions about ${n}.`,
];

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

function remember(items: Record<string, unknown>[], state: BotState, target: string[]): void {
  const seen = new Set(target);
  for (const item of items) {
    const id = idOf(item);
    if (id && !seen.has(id)) {
      seen.add(id);
      target.push(id);
    }
    if (target.length > 250) target.splice(0, target.length - 250);
  }
}

// ── Shared (all roles) ──────────────────────────────────────────────────────

const commonActions: Action[] = [
  { name: 'auth.me', weight: 3, run: ({ client }) => client.get('/api/v1/auth/me', 'auth.me') },
  {
    name: 'permissions.me',
    weight: 2,
    run: ({ client }) => client.get('/api/v1/permissions/me', 'permissions.me'),
  },
  {
    name: 'features.me',
    weight: 2,
    run: ({ client }) => client.get('/api/v1/features/me', 'features.me'),
  },
  { name: 'me.orgs', weight: 2, run: ({ client }) => client.get('/api/v1/me/orgs', 'me.orgs') },
  {
    name: 'me.personal-plan',
    weight: 2,
    run: ({ client }) => client.get('/api/v1/me/personal-plan', 'me.personal-plan'),
  },
  {
    name: 'search',
    weight: 6,
    run: ({ client, rng }) =>
      client.get(`/api/v1/search${qs({ q: pick(rng, SEARCH_TERMS), limit: 10 })}`, 'search.query'),
  },
];

// ── Student journey (the majority of bots) ──────────────────────────────────

const studentActions: Action[] = [
  {
    name: 'decks.list',
    weight: 12,
    run: async (state) => {
      const result = await state.client.get('/api/v1/flashcards/decks?limit=200', 'decks.list');
      remember(extractItems(result.body), state, state.deckIds);
      return result;
    },
  },
  {
    name: 'topics.list',
    weight: 8,
    run: async (state) => {
      const result = await state.client.get('/api/v1/flashcards/topics?limit=200', 'topics.list');
      remember(extractItems(result.body), state, state.topicIds);
      return result;
    },
  },
  {
    name: 'flashcards.list',
    weight: 12,
    run: async (state) => {
      const { client, rng, deckIds, topicIds } = state;
      const path = deckIds.length
        ? `/api/v1/flashcards${qs({ deckIds: pick(rng, deckIds), limit: 50 })}`
        : topicIds.length
          ? `/api/v1/flashcards${qs({ topicIds: pick(rng, topicIds), limit: 50 })}`
          : '/api/v1/flashcards?limit=50';
      const result = await client.get(path, 'flashcards.list');
      remember(extractItems(result.body), state, state.cardIds);
      return result;
    },
  },
  {
    name: 'decks.detail',
    weight: 6,
    available: (s) => s.deckIds.length > 0,
    run: ({ client, rng, deckIds }) =>
      client.get(`/api/v1/flashcards/decks/${pick(rng, deckIds)}`, 'decks.detail'),
  },
  {
    name: 'flashcards.detail',
    weight: 5,
    available: (s) => s.cardIds.length > 0,
    run: ({ client, rng, cardIds }) =>
      client.get(`/api/v1/flashcards/${pick(rng, cardIds)}`, 'flashcards.detail'),
  },
  {
    name: 'practice.due-count',
    weight: 7,
    run: ({ client, rng, deckIds }) =>
      client.get(
        `/api/v1/flashcards/practice/due/count${deckIds.length ? qs({ deckIds: pick(rng, deckIds) }) : ''}`,
        'practice.due-count',
      ),
  },
  {
    name: 'practice.states',
    weight: 5,
    run: ({ client }) => client.get('/api/v1/flashcards/practice/states', 'practice.states'),
  },
  {
    name: 'practice.cards-stats',
    weight: 4,
    run: ({ client }) =>
      client.get(
        '/api/v1/flashcards/practice/cards-stats?sortBy=created_at&order=desc&limit=100',
        'practice.cards-stats',
      ),
  },
  {
    name: 'practice.prepare',
    weight: 7,
    run: ({ client, rng, deckIds, topicIds }) =>
      client.get(
        `/api/v1/flashcards/practice/prepare${deckIds.length ? qs({ deckIds: pick(rng, deckIds) }) : topicIds.length ? qs({ topicIds: pick(rng, topicIds) }) : ''}`,
        'practice.prepare',
      ),
  },
  {
    name: 'practice.review',
    weight: 7,
    run: async (state) => {
      const { client, rng, deckIds, topicIds } = state;
      const path = `/api/v1/flashcards/practice/review${
        deckIds.length
          ? qs({ deckIds: pick(rng, deckIds), limit: 20 })
          : topicIds.length
            ? qs({ topicIds: pick(rng, topicIds), limit: 20 })
            : '?limit=20'
      }`;
      const result = await client.get(path, 'practice.review');
      remember(extractItems(result.body), state, state.cardIds);
      return result;
    },
  },
  {
    name: 'practice.log',
    weight: 6,
    available: (s) => s.cardIds.length > 0,
    run: ({ client, rng, cardIds }) =>
      client.post(
        `/api/v1/flashcards/${pick(rng, cardIds)}/practice`,
        {
          wasCorrect: rng() > 0.3,
          responseTimeMs: randInt(rng, 800, 12_000),
          confidenceLevel: randInt(rng, 1, 5),
        },
        'practice.log',
      ),
  },
  {
    name: 'stats.student',
    weight: 6,
    run: ({ client }) => client.get('/api/v1/stats/student', 'stats.student'),
  },
  {
    name: 'stats.weak-points',
    weight: 4,
    run: ({ client }) => client.get('/api/v1/stats/weak-points', 'stats.weak-points'),
  },
  {
    name: 'stats.activity',
    weight: 4,
    run: ({ client, rng }) =>
      client.get(
        `/api/v1/stats/activity${qs({ range: pick(rng, ['7d', '30d', '90d']) })}`,
        'stats.activity',
      ),
  },
  {
    name: 'quiz.attempts',
    weight: 3,
    run: ({ client }) => client.get('/api/v1/quiz/attempts', 'quiz.attempts'),
  },
  {
    name: 'decks.create',
    weight: 3,
    run: async (state) => {
      const { client, rng } = state;
      const result = await client.post(
        '/api/v1/flashcards/decks',
        {
          name: `Bot Deck ${randInt(rng, 1000, 9999)}`,
          description: 'Created by load-test bot',
        },
        'decks.create',
      );
      const id = idOf((result.body as { data?: Record<string, unknown> } | null)?.data) ?? null;
      if (id) {
        state.deckIds.push(id);
        state.lastDeckId = id;
      }
      return result;
    },
  },
  {
    name: 'flashcards.batch-create',
    weight: 4,
    run: async (state) => {
      const { client, rng } = state;
      let deckId = state.lastDeckId ?? pick(rng, state.deckIds) ?? null;
      const results: ApiResult[] = [];
      if (!deckId) {
        const deck = await client.post(
          '/api/v1/flashcards/decks',
          { name: `Bot Deck ${randInt(rng, 1000, 9999)}` },
          'decks.create',
        );
        results.push(deck);
        deckId = idOf((deck.body as { data?: Record<string, unknown> } | null)?.data) ?? null;
        if (deckId) {
          state.deckIds.push(deckId);
          state.lastDeckId = deckId;
        }
      }
      if (deckId) {
        const cards = Array.from({ length: randInt(rng, 2, 6) }, () => {
          const noun = pick(rng, SEARCH_TERMS) ?? 'concept';
          return {
            front: pick(rng, FRONT_TEMPLATES)?.(noun) ?? `Define ${noun}`,
            back: pick(rng, BACK_TEMPLATES)?.(noun) ?? `${noun} — definition.`,
          };
        });
        const created = await client.post(
          '/api/v1/flashcards/batch/create',
          { deckId, cards },
          'flashcards.batch-create',
        );
        results.push(created);
        remember(extractItems(created.body), state, state.cardIds);
      }
      return results;
    },
  },
];

// ── Educator journey ────────────────────────────────────────────────────────

const educatorActions: Action[] = [
  {
    name: 'stats.teacher',
    weight: 8,
    run: ({ client }) => client.get('/api/v1/stats/teacher', 'stats.teacher'),
  },
  {
    name: 'stats.teacher.activity',
    weight: 6,
    run: ({ client, rng }) =>
      client.get(
        `/api/v1/stats/teacher/activity${qs({ range: pick(rng, ['7d', '30d', '90d']) })}`,
        'stats.teacher.activity',
      ),
  },
  {
    name: 'teacher.quizzes',
    weight: 6,
    run: ({ client }) => client.get('/api/v1/teacher/quizzes', 'teacher.quizzes'),
  },
  {
    name: 'teacher.assignments',
    weight: 6,
    run: ({ client }) => client.get('/api/v1/teacher/assignments', 'teacher.assignments'),
  },
  {
    name: 'flashcards.stats.teacher',
    weight: 6,
    run: ({ client }) => client.get('/api/v1/flashcards/stats/teacher', 'flashcards.stats.teacher'),
  },
  {
    name: 'questions.list',
    weight: 8,
    run: ({ client, rng }) =>
      client.get(
        `/api/v1/questions${qs({ limit: 24, page: randInt(rng, 1, 3) })}`,
        'questions.list',
      ),
  },
  {
    name: 'question-banks.list',
    weight: 6,
    run: ({ client }) => client.get('/api/v1/questions/banks?limit=100', 'question-banks.list'),
  },
  {
    name: 'organization.members',
    weight: 4,
    run: ({ client }) => client.get('/api/v1/organization/members', 'organization.members'),
  },
];

// ── Manager journey ─────────────────────────────────────────────────────────

const managerActions: Action[] = [
  {
    name: 'organization.members',
    weight: 8,
    run: ({ client }) => client.get('/api/v1/organization/members', 'organization.members'),
  },
  {
    name: 'organization.roles',
    weight: 6,
    run: ({ client }) => client.get('/api/v1/organization/roles', 'organization.roles'),
  },
  {
    name: 'organization.groups',
    weight: 6,
    run: ({ client }) => client.get('/api/v1/organization/groups', 'organization.groups'),
  },
  {
    name: 'organization.invites',
    weight: 5,
    run: ({ client }) => client.get('/api/v1/organization/invites', 'organization.invites'),
  },
  {
    name: 'organization.seats',
    weight: 4,
    run: ({ client }) => client.get('/api/v1/organization/seats/pools', 'organization.seats.pools'),
  },
  {
    name: 'stats.teacher',
    weight: 6,
    run: ({ client }) => client.get('/api/v1/stats/teacher', 'stats.teacher'),
  },
  {
    name: 'subscription-plans',
    weight: 4,
    run: ({ client }) => client.get('/api/v1/subscription-plans?for=manager', 'subscription-plans'),
  },
];

export function actionsFor(accountType: AccountRecord['accountType']): Action[] {
  const roleActions =
    accountType === 'educator'
      ? educatorActions
      : accountType === 'manager'
        ? managerActions
        : studentActions;
  // Everyone does the common auth/feature/search calls plus their role journey.
  return [...commonActions, ...roleActions];
}

export function pickWeightedAction(rng: () => number, state: BotState, actions: Action[]): Action {
  const available = actions.filter((action) => !action.available || action.available(state));
  const pool = available.length > 0 ? available : actions;
  const totalWeight = pool.reduce((sum, action) => sum + action.weight, 0);
  let roll = rng() * totalWeight;
  for (const action of pool) {
    roll -= action.weight;
    if (roll <= 0) return action;
  }
  return pool[pool.length - 1];
}
