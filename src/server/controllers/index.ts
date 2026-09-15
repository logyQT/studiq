import { wrapService } from '@/lib/observability';
import { ActivityController } from '@/server/controllers/activity.controller';
import { AuthController } from '@/server/controllers/auth.controller';
import { ClassroomController } from '@/server/controllers/classroom.controller';
import { FeatureFlagController } from '@/server/controllers/feature-flag.controller';
import { FeaturesController } from '@/server/controllers/features.controller';
import { FlashcardController } from '@/server/controllers/flashcard.controller';
import { FlashcardDeckController } from '@/server/controllers/flashcard-deck.controller';
import { FlashcardExportController } from '@/server/controllers/flashcard-export.controller';
import { FlashcardImportController } from '@/server/controllers/flashcard-import.controller';
import { FlashcardPracticeController } from '@/server/controllers/flashcard-practice.controller';
import { FlashcardStatsController } from '@/server/controllers/flashcard-stats.controller';
import { GroupController } from '@/server/controllers/group.controller';
import { HealthController } from '@/server/controllers/health.controller';
import { InvitationController } from '@/server/controllers/invitation.controller';
import { OrgController } from '@/server/controllers/org.controller';
import { OrgRoleController } from '@/server/controllers/org-role.controller';
import { OrganizationController } from '@/server/controllers/organization.controller';
import { OrganizationMemberController } from '@/server/controllers/organization-member.controller';
import { PermissionsController } from '@/server/controllers/permissions.controller';
import { PlanFeatureController } from '@/server/controllers/plan-feature.controller';
import { PlanLimitController } from '@/server/controllers/plan-limit.controller';
import { QuestionController } from '@/server/controllers/question.controller';
import { QuestionBankController } from '@/server/controllers/question-bank.controller';
import { QuestionReportController } from '@/server/controllers/question-report.controller';
import { QuizController } from '@/server/controllers/quiz.controller';
import { QuizAttemptController } from '@/server/controllers/quiz-attempt.controller';
import { QuizTeacherController } from '@/server/controllers/quiz-teacher.controller';
import { SearchController } from '@/server/controllers/search.controller';
import { SeatController } from '@/server/controllers/seat.controller';
import { StatsController } from '@/server/controllers/stats.controller';
import { StripeController } from '@/server/controllers/stripe.controller';
import { SubscriptionPlanController } from '@/server/controllers/subscription-plan.controller';
import { SubscriptionPlanAdminController } from '@/server/controllers/subscription-plan-admin.controller';
import { TeacherAssignmentController } from '@/server/controllers/teacher-assignment.controller';
import { TopicController } from '@/server/controllers/topic.controller';
import { UserOverrideController } from '@/server/controllers/user-override.controller';
import {
  activityService,
  authService,
  classroomService,
  featureFlagService,
  flashcardDeckService,
  flashcardExportService,
  flashcardImportService,
  flashcardPracticeService,
  flashcardService,
  flashcardStatsService,
  groupService,
  healthService,
  invitationService,
  mockStripeService,
  organizationMemberService,
  organizationService,
  orgRoleService,
  orgService,
  planFeatureService,
  planLimitService,
  questionBankService,
  questionReportService,
  questionService,
  quizAttemptService,
  quizService,
  quizTeacherService,
  searchService,
  seatService,
  statsService,
  subscriptionPlanService,
  teacherAssignmentService,
  topicService,
  userOverrideService,
} from '@/server/services';

export const activityController = wrapService(
  new ActivityController(activityService),
  'activity.controller',
);
export const authController = wrapService(new AuthController(authService), 'auth.controller');
export const classroomController = wrapService(
  new ClassroomController(classroomService),
  'classroom.controller',
);
export const featureFlagController = wrapService(
  new FeatureFlagController(featureFlagService),
  'feature-flag.controller',
);
export const flashcardController = wrapService(
  new FlashcardController(flashcardService),
  'flashcard.controller',
);
export const flashcardDeckController = wrapService(
  new FlashcardDeckController(flashcardDeckService),
  'flashcard-deck.controller',
);
export const flashcardExportController = wrapService(
  new FlashcardExportController(flashcardExportService),
  'flashcard-export.controller',
);
export const flashcardImportController = wrapService(
  new FlashcardImportController(flashcardImportService),
  'flashcard-import.controller',
);
export const flashcardPracticeController = wrapService(
  new FlashcardPracticeController(flashcardPracticeService),
  'flashcard-practice.controller',
);
export const flashcardStatsController = wrapService(
  new FlashcardStatsController(flashcardStatsService),
  'flashcard-stats.controller',
);
export const groupController = wrapService(new GroupController(groupService), 'group.controller');
export const healthController = wrapService(
  new HealthController(healthService),
  'health.controller',
);
export const invitationController = wrapService(
  new InvitationController(invitationService),
  'invitation.controller',
);
export const orgController = wrapService(new OrgController(orgService), 'org.controller');
export const orgRoleController = wrapService(
  new OrgRoleController(orgRoleService),
  'org-role.controller',
);
export const organizationController = wrapService(
  new OrganizationController(organizationService),
  'organization.controller',
);
export const organizationMemberController = wrapService(
  new OrganizationMemberController(organizationMemberService),
  'organization-member.controller',
);
export const permissionsController = wrapService(
  new PermissionsController(),
  'permissions.controller',
);
export const featuresController = wrapService(new FeaturesController(), 'features.controller');
export const planFeatureController = wrapService(
  new PlanFeatureController(planFeatureService),
  'plan-feature.controller',
);
export const planLimitController = wrapService(
  new PlanLimitController(planLimitService),
  'plan-limit.controller',
);
export const questionController = wrapService(
  new QuestionController(questionService),
  'question.controller',
);
export const questionBankController = wrapService(
  new QuestionBankController(questionBankService),
  'question-bank.controller',
);
export const questionReportController = wrapService(
  new QuestionReportController(questionReportService),
  'question-report.controller',
);
export const quizController = wrapService(new QuizController(quizService), 'quiz.controller');
export const quizAttemptController = wrapService(
  new QuizAttemptController(quizAttemptService),
  'quiz-attempt.controller',
);
export const quizTeacherController = wrapService(
  new QuizTeacherController(quizTeacherService),
  'quiz-teacher.controller',
);
export const seatController = wrapService(new SeatController(seatService), 'seat.controller');
export const searchController = wrapService(
  new SearchController(searchService),
  'search.controller',
);
export const statsController = wrapService(new StatsController(statsService), 'stats.controller');
export const teacherAssignmentController = wrapService(
  new TeacherAssignmentController(teacherAssignmentService),
  'teacher-assignment.controller',
);
export const stripeController = wrapService(
  new StripeController(mockStripeService),
  'stripe.controller',
);
export const subscriptionPlanController = wrapService(
  new SubscriptionPlanController(subscriptionPlanService),
  'subscription-plan.controller',
);
export const subscriptionPlanAdminController = wrapService(
  new SubscriptionPlanAdminController(subscriptionPlanService),
  'subscription-plan-admin.controller',
);
export const topicController = wrapService(new TopicController(topicService), 'topic.controller');
export const userOverrideController = wrapService(
  new UserOverrideController(userOverrideService),
  'user-override.controller',
);
