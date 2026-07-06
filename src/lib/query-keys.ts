export const flashcardKeys = {
  all: ['flashcards'] as const,
  decks: {
    all: ['flashcards', 'decks'] as const,
    list: (filters?: Record<string, string | undefined>) =>
      ['flashcards', 'decks', 'list', filters] as const,
    paginated: (filters?: Record<string, string | undefined>) =>
      ['flashcards', 'decks', 'paginated', filters] as const,
    detail: (id: string) => ['flashcards', 'decks', id] as const,
  },
  list: (filters?: Record<string, string[]>) => ['flashcards', 'list', filters] as const,
  practice: {
    dueBreakdown: ['flashcards', 'practice', 'dueBreakdown'] as const,
    states: ['flashcards', 'practice', 'states'] as const,
  },
  stats: {
    teacher: ['flashcards', 'stats', 'teacher'] as const,
    difficultyBucket: (bucket: string) => ['flashcards', 'stats', 'difficulty', bucket] as const,
    activity: (range: string) => ['stats', 'activity', range] as const,
    weakPoints: ['stats', 'weak-points'] as const,
  },
};

export const topicKeys = {
  all: ['topics'] as const,
  paginated: (filters?: Record<string, string | undefined>) =>
    ['topics', 'paginated', filters] as const,
};

export const questionKeys = {
  all: ['questions'] as const,
  list: (filters?: Record<string, string | undefined>) => ['questions', 'list', filters] as const,
  detail: (id: string) => ['questions', id] as const,
  banks: {
    all: ['questions', 'banks'] as const,
    paginated: (filters?: Record<string, string | undefined>) =>
      ['questions', 'banks', 'paginated', filters] as const,
    detail: (id: string) => ['questions', 'banks', id] as const,
  },
};

export const permissionKeys = {
  all: ['permissions'] as const,
  me: ['permissions', 'me'] as const,
};

export const groupKeys = {
  all: ['groups'] as const,
  list: (orgId?: string) => ['groups', 'list', orgId] as const,
  detail: (id: string) => ['groups', id] as const,
  members: (groupId: string) => ['groups', groupId, 'members'] as const,
  my: ['groups', 'my'] as const,
};

export const searchKeys = {
  all: ['search'] as const,
  query: (q: string) => ['search', q] as const,
};
