/**
 * Breadcrumb route map (pure, framework-free).
 *
 * The dashboard layout derives a trail from the URL. Every static segment must
 * come from a translation key, and dynamic id segments must come from the
 * label the owning page publishes (`useBreadcrumbLabel`) — a raw UUID is never
 * rendered. Keeping the map here (instead of inline in the layout) makes the
 * whole route surface testable, see `__tests__/unit/lib/breadcrumbs.test.ts`.
 */

export interface BreadcrumbEntry {
  /** Dotted message key, resolved by the root `next-intl` translator. */
  labelKey: string;
  /** `false` => group prefix with no page of its own: render plain text, not a link. */
  link?: false;
}

/**
 * Route prefixes that intentionally never render a crumb: redirect stubs with
 * no page of their own. Their children publish the labels.
 */
export const OMITTED_PREFIXES = ['/app/study', '/app/study/session'] as const;

export const ID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Static route prefixes. Dynamic id segments are normalised to a wildcard for
 * lookup, so `/edu/assignments/<uuid>/results` resolves the wildcard route.
 */
export const PATH_LABELS: Record<string, BreadcrumbEntry> = {
  // Area roots — the localized dashboard names every header already shows.
  '/edu': { labelKey: 'DashboardLayout.teacher_dashboard' },
  '/app': { labelKey: 'DashboardLayout.student_dashboard' },
  '/manage': { labelKey: 'DashboardLayout.university_dashboard' },

  // AI assistant
  '/edu/ai': { labelKey: 'DashboardLayout.ai_chat' },
  '/app/ai': { labelKey: 'DashboardLayout.ai_chat' },

  // Educator content
  '/edu/flashcards': { labelKey: 'EduFlashcardDecksPage.title' },
  '/edu/flashcards/stats': { labelKey: 'EduFlashcardStatsPage.title' },
  '/edu/flashcards/stats/difficulty': { labelKey: 'Breadcrumbs.difficulty', link: false },
  '/edu/flashcards/stats/difficulty/easy': { labelKey: 'DifficultyPage.title_easy' },
  '/edu/flashcards/stats/difficulty/medium': { labelKey: 'DifficultyPage.title_medium' },
  '/edu/flashcards/stats/difficulty/hard': { labelKey: 'DifficultyPage.title_hard' },
  '/edu/flashcards/stats/difficulty/new': { labelKey: 'DifficultyPage.title_new' },
  '/edu/questions': { labelKey: 'EduQuestionsPage.title' },
  '/edu/topics': { labelKey: 'EduFlashcardTopicsPage.title' },

  '/edu/quizzes': { labelKey: 'EduQuizzesPage.title' },
  '/edu/quizzes/new': { labelKey: 'EduQuizNewPage.title' },
  '/edu/quizzes/*/edit': { labelKey: 'EduQuizEditPage.title' },

  '/edu/assignments': { labelKey: 'EduAssignmentsPage.title' },
  '/edu/assignments/new': { labelKey: 'EduAssignmentNewPage.title' },
  '/edu/assignments/settings': { labelKey: 'EduAssignmentSettingsPage.title' },
  '/edu/assignments/*/edit': { labelKey: 'EduAssignmentEditPage.title' },
  '/edu/assignments/*/print': { labelKey: 'Breadcrumbs.print_assignment' },
  '/edu/assignments/*/results': { labelKey: 'EduAssignmentResultsPage.title' },
  // `[studentId]` / `[qId]` are UUIDs, dropped before the route lookup — there is
  // deliberately no `/…/results/*` entry (keep the trail free of raw ids).
  '/edu/assignments/*/results/question': {
    labelKey: 'EduPerQuestionGradingPage.title',
    link: false,
  },

  // Question reports (all three areas share the screen)
  '/edu/reports': { labelKey: 'QuestionReports.page_title' },
  '/app/reports': { labelKey: 'QuestionReports.page_title' },
  '/manage/reports': { labelKey: 'QuestionReports.page_title' },

  // Groups
  '/edu/groups': { labelKey: 'ManageGroupsPage.title' },
  '/manage/groups': { labelKey: 'ManageGroupsPage.title' },

  // Classroom
  '/edu/classroom': { labelKey: 'DashboardLayout.edu_classroom', link: false },
  '/edu/classroom/new': { labelKey: 'NewClassroomPage.title' },
  '/edu/classroom/invite': { labelKey: 'ClassroomInvitePage.title' },
  '/edu/classroom/members': { labelKey: 'ClassroomMembersPage.title' },

  // Statistics
  '/edu/stats': { labelKey: 'DashboardLayout.sidebar_statistics', link: false },
  '/edu/stats/data': { labelKey: 'StatsDataPage.title' },
  '/edu/stats/results': { labelKey: 'StatsResultsPage.title' },
  '/edu/stats/activity': { labelKey: 'TeacherActivityPage.title' },
  '/edu/stats/quizzes': { labelKey: 'TeacherQuizStats.title' },
  '/edu/statistics': { labelKey: 'EduStatisticsPage.title' },

  // Account area (shared by every dashboard)
  '/edu/account': { labelKey: 'AccountPage.title' },
  '/app/account': { labelKey: 'AccountPage.title' },
  '/manage/account': { labelKey: 'AccountPage.title' },
  '/edu/account/payments': { labelKey: 'AccountPage.payments_title' },
  '/app/account/payments': { labelKey: 'AccountPage.payments_title' },
  '/edu/billing': { labelKey: 'BillingPage.title' },
  '/app/billing': { labelKey: 'BillingPage.title' },
  '/manage/billing': { labelKey: 'BillingPage.title' },
  '/edu/upgrade': { labelKey: 'UpgradePage.title' },
  '/app/upgrade': { labelKey: 'UpgradePage.title' },
  '/manage/upgrade': { labelKey: 'UpgradePage.title' },

  // Student area
  '/app/flashcards': { labelKey: 'AppFlashcardDecksPage.title' },
  '/app/questions': { labelKey: 'AppMyQuestionsPage.title' },
  '/app/topics': { labelKey: 'AppFlashcardTopicsPage.title' },
  '/app/assignments': { labelKey: 'AppAssignmentsPage.title' },
  '/app/assignments/*/take': { labelKey: 'Breadcrumbs.take_assignment' },
  '/app/assignments/*/review': { labelKey: 'Breadcrumbs.assignment_review' },
  '/app/stats': { labelKey: 'AppStatsPage.title' },
  '/app/stats/content': { labelKey: 'StatsDataPage.title' },
  '/app/stats/results': { labelKey: 'StatsResultsPage.title' },
  '/app/stats/activity': { labelKey: 'DashboardLayout.stats_activity' },
  '/app/study/learn': { labelKey: 'DashboardLayout.app_learn' },
  '/app/study/cram': { labelKey: 'DashboardLayout.app_cram' },
  '/app/study/quiz': { labelKey: 'DashboardLayout.app_quiz' },
  '/app/study/live': { labelKey: 'AppLiveStudyPage.title' },
  '/app/study/live/faq': { labelKey: 'Breadcrumbs.live_faq' },
  '/app/study/session/review': { labelKey: 'Breadcrumbs.session_review' },
  '/app/study/session/new': { labelKey: 'Breadcrumbs.session_new' },
  '/app/study/session/cram': { labelKey: 'DashboardLayout.app_cram' },
  '/app/study/session/quiz': {
    labelKey: 'DashboardLayout.breadcrumb_quiz_session',
    // Intermediate crumb only. `/app/study/session/[type]/page.tsx` accepts
    // review|new|cram, so this exact prefix has no page and 404s.
    link: false,
  },
  '/app/study/session/quiz/*/review': { labelKey: 'DashboardLayout.breadcrumb_quiz_review' },
  '/app/join': { labelKey: 'AppJoinPage.title' },

  // University management
  '/manage/members': { labelKey: 'ManageMembersPage.title' },
  '/manage/invites': { labelKey: 'ManageInvitationsPage.title' },
  '/manage/roles': { labelKey: 'ManageRolesPage.title' },
  '/manage/seats': { labelKey: 'ManageSeatsPage.title' },
  '/manage/settings': { labelKey: 'ManageSettingsPage.title' },
};

export interface Crumb {
  /** `null` => not clickable (group prefix, or the current page). */
  href: string | null;
  label: string;
  isCurrent: boolean;
}

export interface BuildBreadcrumbsOptions {
  pathname: string;
  /** segment value -> human label, published by the page that owns the entity. */
  names: Record<string, string>;
  /** next-intl root translator: `t('Namespace.key')`. */
  t: (key: string) => string;
}

/**
 * Build the trail for `pathname`:
 * - a published entity name wins (linkable unless it is the leaf),
 * - otherwise a UUID segment is dropped — never rendered,
 * - otherwise the static route map provides the label,
 * - unknown static segments are dropped (safety net; the route-coverage test
 *   keeps the map in sync with the filesystem).
 */
export function buildBreadcrumbs({ pathname, names, t }: BuildBreadcrumbsOptions): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: Crumb[] = [];
  const walked: string[] = [];

  for (const segment of segments) {
    walked.push(segment);
    const href = `/${walked.join('/')}`;

    const published = names[segment];
    if (published) {
      crumbs.push({ href, label: published, isCurrent: false });
      continue;
    }

    if (ID_SEGMENT.test(segment)) continue;

    const route = `/${walked.map((part) => (ID_SEGMENT.test(part) ? '*' : part)).join('/')}`;
    const entry = PATH_LABELS[route];
    if (!entry) continue;

    const label = t(entry.labelKey);
    if (!label) continue;

    crumbs.push({
      href: entry.link === false ? null : href,
      label,
      isCurrent: false,
    });
  }

  return crumbs.map((crumb, index) =>
    index === crumbs.length - 1 ? { ...crumb, href: null, isCurrent: true } : crumb,
  );
}
