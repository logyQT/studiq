import type { QueryKey } from '@tanstack/react-query';

export const flashcardKeys = {
  all: ['flashcards'] as const,
  decks: {
    all: ['flashcards', 'decks'] as const,
    list: (filters?: Record<string, string | undefined>) =>
      ['flashcards', 'decks', 'list', filters] as const,
    // Org-scoped list endpoints resolve their rows from the `active_org_id`
    // cookie, so the cache entry must be keyed by the active org too —
    // otherwise switching orgs keeps serving the previous org's rows (#135).
    // The org id sits after the kind segment so `decks.all` stays a valid
    // invalidation prefix.
    paginated: (filters?: Record<string, string | undefined>, orgId?: string | null) =>
      ['flashcards', 'decks', 'paginated', orgId ?? null, filters] as const,
    // Deck pickers (`?limit=200`) — also org-scoped, never `decks.all` itself.
    options: (orgId?: string | null) => ['flashcards', 'decks', 'options', orgId ?? null] as const,
    detail: (id: string) => ['flashcards', 'decks', id] as const,
  },
  list: (filters?: Record<string, string[]>) => ['flashcards', 'list', filters] as const,
  practice: {
    all: ['flashcards', 'practice'] as const,
    dueBreakdown: ['flashcards', 'practice', 'dueBreakdown'] as const,
    states: ['flashcards', 'practice', 'states'] as const,
  },
  /**
   * Everything a deck suspend / restore changes: the deck lists and the study statistics built
   * from the deck's cards (cards-stats, states, due counts). Invalidating only the deck lists
   * left the statistics showing a suspended deck's cards until a full reload (#365).
   */
  afterDeckSuspend: [
    ['flashcards', 'decks'] as const,
    ['flashcards', 'practice'] as const,
  ] as const,
  /** A finished study session moves the statistics, the due counts and the deck progress. */
  afterStudySession: [
    ['flashcards', 'practice'] as const,
    ['flashcards', 'stats'] as const,
    ['flashcards', 'decks'] as const,
    // The student statistics, including the insights (study time, mastery, retention) that a
    // finished session changes (#365, #657).
    ['stats', 'student'] as const,
  ] as const,
  stats: {
    teacher: ['flashcards', 'stats', 'teacher'] as const,
    difficultyBucket: (bucket: string) => ['flashcards', 'stats', 'difficulty', bucket] as const,
    activity: (range: string) => ['stats', 'activity', range] as const,
    weakPoints: ['stats', 'weak-points'] as const,
  },
};

export const topicKeys = {
  all: ['topics'] as const,
  paginated: (filters?: Record<string, string | undefined>, orgId?: string | null) =>
    ['topics', 'paginated', orgId ?? null, filters] as const,
  // Topic pickers (`?limit=200`) — org-scoped, and nested under `topicKeys.all`
  // so topic CRUD invalidations refresh them.
  options: (orgId?: string | null) => ['topics', 'options', orgId ?? null] as const,
};

export const questionKeys = {
  all: ['questions'] as const,
  list: (filters?: Record<string, string | undefined>) => ['questions', 'list', filters] as const,
  detail: (id: string) => ['questions', id] as const,
  banks: {
    all: ['questions', 'banks'] as const,
    paginated: (filters?: Record<string, string | undefined>, orgId?: string | null) =>
      ['questions', 'banks', 'paginated', orgId ?? null, filters] as const,
    detail: (id: string) => ['questions', 'banks', id] as const,
  },
};

export const permissionKeys = {
  all: ['permissions'] as const,
  me: ['permissions', 'me'] as const,
};

export const featureKeys = {
  all: ['features'] as const,
  me: ['features', 'me'] as const,
};

export const aiKeys = {
  all: ['ai'] as const,
  usage: ['ai', 'usage'] as const,
};

export const groupKeys = {
  all: ['groups'] as const,
  list: (orgId?: string) => ['groups', 'list', orgId] as const,
  detail: (id: string) => ['groups', id] as const,
  members: (groupId: string) => ['groups', groupId, 'members'] as const,
  my: ['groups', 'my'] as const,
};

export const organizationKeys = {
  all: ['organization'] as const,
  members: (orgId?: string) => ['organization', orgId, 'members'] as const,
};

export const questionReportKeys = {
  all: ['question-reports'] as const,
  list: (filters?: Record<string, string | undefined>) =>
    ['question-reports', 'list', filters] as const,
  detail: (id: string) => ['question-reports', id] as const,
  unreadCount: ['question-reports', 'unread-count'] as const,
};

export const assignmentKeys = {
  all: ['teacher-assignments'] as const,
  detail: (id: string) => ['teacher-assignments', id] as const,
  results: (id: string) => ['teacher-assignments', id, 'results'] as const,
  studentResults: (id: string, studentId: string) =>
    ['teacher-assignments', id, 'results', studentId] as const,
  /**
   * Keys a grading mutation must invalidate (#168): the results *list* prefix.
   * It also matches the nested `studentResults(id, studentId)` entry, so the
   * grading header refreshes too. Invalidating only `studentResults` leaves the
   * results table cached: `useApiQuery` defaults to `staleTime: Infinity`, so the
   * stale row survives in-app navigation and is only refetched once the list key
   * is invalidated (a full reload works because it clears the cache).
   */
  gradingInvalidations: (id: string): QueryKey[] => [assignmentKeys.results(id)],
};

export const studentAssignmentKeys = {
  all: ['student-assignments'] as const,
  detail: (id: string) => ['student-assignments', id] as const,
};

export const quizKeys = {
  all: ['teacher-quizzes'] as const,
  detail: (id: string) => ['teacher-quizzes', id] as const,
};

export const quizAttemptKeys = {
  all: ['quiz', 'attempts'] as const,
};

export const studentStatsKeys = {
  all: ['stats', 'student'] as const,
  overview: ['stats', 'student', 'overview'] as const,
  insights: (days: number) => ['stats', 'student', 'insights', days] as const,
};

export const teacherStatsKeys = {
  all: ['stats', 'teacher'] as const,
  overview: (orgId: string | null) => ['stats', 'teacher', 'overview', orgId] as const,
  groups: (orgId: string | null, days: number) =>
    ['stats', 'teacher', 'groups', orgId, days] as const,
  feed: (orgId: string | null) => ['stats', 'teacher', 'feed', orgId] as const,
};

export const searchKeys = {
  all: ['search'] as const,
  query: (q: string) => ['search', q] as const,
};

export const paymentKeys = {
  all: ['me', 'payments'] as const,
};

export const statusKeys = {
  all: ['status'] as const,
  health: ['status', 'health'] as const,
};
