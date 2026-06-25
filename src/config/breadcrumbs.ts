export interface BreadcrumbRouteEntry {
  labelKey: string;
  namespace?: string;
  href?: string;
}

export const BREADCRUMB_ROUTES: Record<string, BreadcrumbRouteEntry> = {
  '/app': { labelKey: 'student_dashboard', namespace: 'DashboardLayout' },
  '/app/flashcards': { labelKey: 'app_flashcards', namespace: 'DashboardLayout' },
  '/app/flashcards/decks': { labelKey: 'decks_title', namespace: 'AppFlashcardsPage' },
  '/app/flashcards/decks/[deckId]': {
    labelKey: 'decks_title',
    namespace: 'AppFlashcardsPage',
    href: '/app/flashcards/decks',
  },
  '/app/flashcards/topics': { labelKey: 'topics_title', namespace: 'AppFlashcardsPage' },
  '/app/flashcards/study': { labelKey: 'study_title', namespace: 'AppFlashcardsPage' },
  '/app/flashcards/session': {
    labelKey: 'breadcrumb_session',
    namespace: 'AppFlashcardSessionPage',
  },
  '/app/flashcards/stats': { labelKey: 'stats_title', namespace: 'AppFlashcardStatsPage' },
  '/app/flashcards/ai': { labelKey: 'app_ai_generate', namespace: 'DashboardLayout' },
  '/app/ai': { labelKey: 'ai_chat', namespace: 'DashboardLayout' },
  '/app/quiz': { labelKey: 'app_quiz', namespace: 'DashboardLayout' },
  '/app/quiz/session/[attemptId]': {
    labelKey: 'breadcrumb_quiz_session',
    namespace: 'DashboardLayout',
  },
  '/app/quiz/review/[attemptId]': {
    labelKey: 'breadcrumb_quiz_review',
    namespace: 'DashboardLayout',
  },
  '/app/my-questions': { labelKey: 'app_my_questions', namespace: 'DashboardLayout' },
  '/app/statistics': { labelKey: 'app_statistics', namespace: 'DashboardLayout' },

  '/edu': { labelKey: 'teacher_dashboard', namespace: 'DashboardLayout' },
  '/edu/flashcards': { labelKey: 'edu_flashcards', namespace: 'DashboardLayout' },
  '/edu/flashcards/decks': { labelKey: 'decks_title', namespace: 'EduFlashcardsPage' },
  '/edu/flashcards/decks/[deckId]': {
    labelKey: 'decks_title',
    namespace: 'EduFlashcardsPage',
    href: '/edu/flashcards/decks',
  },
  '/edu/flashcards/topics': { labelKey: 'topics_title', namespace: 'EduFlashcardsPage' },
  '/edu/flashcards/stats': { labelKey: 'stats_title', namespace: 'EduFlashcardsPage' },
  '/edu/flashcards/stats/difficulty/[bucket]': {
    labelKey: 'stats_title',
    namespace: 'EduFlashcardsPage',
  },
  '/edu/questions': { labelKey: 'edu_questions', namespace: 'DashboardLayout' },
  '/edu/statistics': { labelKey: 'edu_statistics', namespace: 'DashboardLayout' },

  '/admin': { labelKey: 'sys_admin_dashboard', namespace: 'DashboardLayout' },
  '/admin/logs': { labelKey: 'admin_error_logs', namespace: 'DashboardLayout' },
  '/admin/permissions': { labelKey: 'admin_permissions', namespace: 'DashboardLayout' },

  '/manage': { labelKey: 'university_dashboard', namespace: 'DashboardLayout' },
  '/manage/members': { labelKey: 'manage_members', namespace: 'DashboardLayout' },
  '/manage/invitations': { labelKey: 'manage_invitations', namespace: 'DashboardLayout' },
  '/manage/settings': { labelKey: 'manage_settings', namespace: 'DashboardLayout' },
};
