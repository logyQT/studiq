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
  list: (filters?: Record<string, string[]>) =>
    ['flashcards', 'list', filters] as const,
  topics: {
    all: ['flashcards', 'topics'] as const,
    paginated: (filters?: Record<string, string | undefined>) =>
      ['flashcards', 'topics', 'paginated', filters] as const,
  },
  practice: {
    dueBreakdown: ['flashcards', 'practice', 'dueBreakdown'] as const,
  },
  stats: {
    teacher: ['flashcards', 'stats', 'teacher'] as const,
    difficultyBucket: (bucket: string) => ['flashcards', 'stats', 'difficulty', bucket] as const,
  },
};

export const searchKeys = {
  all: ['search'] as const,
  query: (q: string) => ['search', q] as const,
};
