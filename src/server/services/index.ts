import { wrapService } from '@/lib/observability';
import { createClient } from '@/lib/supabase/server';
import { ActivityService } from '@/server/services/activity.service';
import { agentTraceService as _agentTraceService } from '@/server/services/agent-trace.service';
import { chatService as _chatService } from '@/server/services/ai-chat.service';
import { AuthService } from '@/server/services/auth.service';
import { ClassroomService } from '@/server/services/classroom.service';
import { FeatureFlagService } from '@/server/services/feature-flag.service';
import { FlashcardService } from '@/server/services/flashcard.service';
import { FlashcardDeckService } from '@/server/services/flashcard-deck.service';
import { FlashcardExportService } from '@/server/services/flashcard-export.service';
import { FlashcardImportService } from '@/server/services/flashcard-import.service';
import { FlashcardPracticeService } from '@/server/services/flashcard-practice.service';
import { FlashcardStatsService } from '@/server/services/flashcard-stats.service';
import { GroupService } from '@/server/services/group.service';
import { HealthService } from '@/server/services/health.service';
import { InvitationService } from '@/server/services/invitation.service';
import { MockStripeService } from '@/server/services/mock-stripe.service';
import { OrgService } from '@/server/services/org.service';
import { OrgRoleService } from '@/server/services/org-role.service';
import { OrganizationService } from '@/server/services/organization.service';
import { OrganizationMemberService } from '@/server/services/organization-member.service';
import { pdfService as _pdfService } from '@/server/services/pdf.service';
import { pdfCacheService as _pdfCacheService } from '@/server/services/pdf-cache.service';
import { PlanResolver } from '@/server/services/plan.resolver';
import { PlanFeatureService } from '@/server/services/plan-feature.service';
import { PlanLimitService } from '@/server/services/plan-limit.service';
import { QuestionService } from '@/server/services/question.service';
import { QuestionBankService } from '@/server/services/question-bank.service';
import { QuizService } from '@/server/services/quiz.service';
import { QuizAttemptService } from '@/server/services/quiz-attempt.service';
import { SearchService } from '@/server/services/search.service';
import { SeatService } from '@/server/services/seat.service';
import { StatsService } from '@/server/services/stats.service';
import { SubscriptionPlanService } from '@/server/services/subscription-plan.service';
import { TeacherAssignmentService } from '@/server/services/teacher-assignment.service';
import { TopicService } from '@/server/services/topic.service';
import { UserOverrideService } from '@/server/services/user-override.service';

export const authService = wrapService(new AuthService(createClient), 'auth.service');
export const flashcardDeckService = wrapService(
  new FlashcardDeckService(createClient),
  'flashcard-deck.service',
);
export const flashcardExportService = wrapService(
  new FlashcardExportService(createClient),
  'flashcard-export.service',
);
export const flashcardImportService = wrapService(
  new FlashcardImportService(createClient),
  'flashcard-import.service',
);
export const flashcardPracticeService = wrapService(
  new FlashcardPracticeService(createClient),
  'flashcard-practice.service',
);
export const flashcardStatsService = wrapService(
  new FlashcardStatsService(createClient),
  'flashcard-stats.service',
);
export const flashcardService = wrapService(
  new FlashcardService(createClient),
  'flashcard.service',
);
export const groupService = wrapService(new GroupService(createClient), 'group.service');
export const healthService = wrapService(new HealthService(createClient), 'health.service');
export const invitationService = wrapService(
  new InvitationService(createClient),
  'invitation.service',
);
export const planFeatureService = wrapService(
  new PlanFeatureService(createClient),
  'plan-feature.service',
);
export const planLimitService = wrapService(
  new PlanLimitService(createClient),
  'plan-limit.service',
);
export const planResolver = wrapService(new PlanResolver(createClient), 'plan-resolver.service');
export const chatService = wrapService(_chatService, 'ai-chat.service', { group: 'ai' });
export const agentTraceService = wrapService(_agentTraceService, 'agent-trace.service', {
  group: 'ai',
});
export const pdfService = wrapService(_pdfService, 'pdf.service');
export const pdfCacheService = wrapService(_pdfCacheService, 'pdf-cache.service');
export const mockStripeService = wrapService(
  new MockStripeService(createClient),
  'mock-stripe.service',
);
export const orgRoleService = wrapService(new OrgRoleService(createClient), 'org-role.service');
export const orgService = wrapService(new OrgService(createClient), 'org.service');
export const questionBankService = wrapService(
  new QuestionBankService(createClient),
  'question-bank.service',
);
export const questionService = wrapService(new QuestionService(createClient), 'question.service');
export const quizAttemptService = wrapService(
  new QuizAttemptService(createClient),
  'quiz-attempt.service',
);
export const quizService = wrapService(new QuizService(createClient), 'quiz.service');
export const featureFlagService = wrapService(
  new FeatureFlagService(createClient),
  'feature-flag.service',
);
export const organizationService = wrapService(
  new OrganizationService(createClient),
  'organization.service',
);
export const organizationMemberService = wrapService(
  new OrganizationMemberService(createClient),
  'organization-member.service',
);
export const subscriptionPlanService = wrapService(
  new SubscriptionPlanService(createClient),
  'subscription-plan.service',
);
export const userOverrideService = wrapService(
  new UserOverrideService(createClient),
  'user-override.service',
);
export const activityService = wrapService(new ActivityService(createClient), 'activity.service');
export const classroomService = wrapService(
  new ClassroomService(createClient),
  'classroom.service',
);
export const seatService = wrapService(new SeatService(createClient), 'seat.service');
export const searchService = wrapService(new SearchService(createClient), 'search.service');
export const statsService = wrapService(new StatsService(createClient), 'stats.service');
export const teacherAssignmentService = wrapService(
  new TeacherAssignmentService(createClient),
  'teacher-assignment.service',
);
export const topicService = wrapService(new TopicService(createClient), 'topic.service');

export * from '@/server/services/ai-prompts';
export * from '@/server/services/ai-utils';
export * from '@/server/services/flashcard-spaced-repetition.service';

export * from '@/server/services/storage.service';
