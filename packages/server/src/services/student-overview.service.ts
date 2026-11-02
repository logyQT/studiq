import type { RequestContext } from '@studiq/authz';
import { gradableQuestionCounts } from '@studiq/server/lib/gradable-questions';
import { wrapService } from '@studiq/server/lib/observability';
import { isRecord } from '@studiq/server/lib/record';
import { isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  ResumeDeck,
  ResumeQuiz,
  StudentActivityItem,
  StudentOverview,
} from '@studiq/server/models/student-overview.model';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const DAY_MS = 24 * 60 * 60 * 1000;
/** An unfinished practice quiz older than this is abandoned, not something to resume. */
const RESUME_WINDOW_DAYS = 7;
const ACTIVITY_LIMIT = 8;

/**
 * The queries below filter on these timestamps (`started_at >= …`,
 * `completed_at is not null`), so the predicates turn the nullable generated
 * column into the non-null type the dashboard models use.
 */
function hasStartedAt<T extends { started_at: string | null }>(
  row: T,
): row is T & { started_at: string } {
  return row.started_at !== null;
}

function hasCompletedAt<T extends { completed_at: string | null }>(
  row: T,
): row is T & { completed_at: string } {
  return row.completed_at !== null;
}

function configTitle(config: unknown): string | null {
  if (!isRecord(config)) return null;
  const title = config.title;
  return typeof title === 'string' && title !== '' ? title : null;
}

/**
 * Questions answered so far in an unfinished attempt. An open attempt keeps its answers in the
 * `draft_answers` column (autosave); `student_answers` only gets rows when it is submitted.
 */
export function countDraftAnswers(draft: unknown): number {
  if (!isRecord(draft) || Array.isArray(draft)) return 0;
  return Object.values(draft).filter((entry) => {
    if (!isRecord(entry)) return false;
    const { selected_answer_id: selected, text_answer: text } = entry;
    return (
      (typeof selected === 'string' && selected !== '') ||
      (typeof text === 'string' && text.trim() !== '')
    );
  }).length;
}

/**
 * Score as a percentage, 0-100, on the same denominator the review page and /app/stats use:
 * an assignment is in points, a practice quiz is correct answers over the closed (gradable)
 * questions (#329, #619). `null` when there is no denominator, instead of a made-up 0 %.
 */
function scorePercent(
  row: {
    assignment_id: string | null;
    total_points: number | null;
    total_questions: number;
    score: number | null;
  },
  gradable: number | undefined,
): number | null {
  const max = row.assignment_id ? (row.total_points ?? row.total_questions ?? 0) : (gradable ?? 0);
  if (max <= 0) return null;
  return Math.round(Math.min(100, Math.max(0, ((row.score ?? 0) / max) * 100)));
}

/**
 * The personalised part of the student dashboard (#655): what to continue, what was done
 * today, and the latest activity. Everything is the caller's own data, read through the
 * request client so RLS stays the floor.
 */
export class StudentOverviewService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async getOverview(
    ctx: RequestContext,
    now = new Date(),
  ): Promise<ServiceResult<StudentOverview>> {
    const supabase = await this.clientFactory();
    const today = now.toISOString().slice(0, 10);
    const resumeSince = new Date(now.getTime() - RESUME_WINDOW_DAYS * DAY_MS).toISOString();

    const [open, sessions, completed, daily] = await Promise.all([
      supabase
        .from('quiz_attempts')
        .select('id, total_questions, started_at, config, draft_answers')
        .eq('user_id', ctx.userId)
        .is('completed_at', null)
        // The durable marker, not `assignment_id`: it is NULL on an assignment attempt whose
        // assignment was deleted (#657).
        .eq('is_assignment_attempt', false)
        .gte('started_at', resumeSince)
        .order('started_at', { ascending: false })
        .limit(1),
      supabase
        .from('flashcard_study_sessions')
        .select('completed_at, cards_studied, deck_ids')
        .eq('user_id', ctx.userId)
        .order('completed_at', { ascending: false })
        .limit(ACTIVITY_LIMIT),
      supabase
        .from('quiz_attempts')
        .select(
          'id, score, total_questions, total_points, completed_at, assignment_id, config, teacher_assignments(title, show_results)',
        )
        .eq('user_id', ctx.userId)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(ACTIVITY_LIMIT),
      supabase
        .from('user_daily_activity')
        .select('reviews_count')
        .eq('user_id', ctx.userId)
        .eq('date', today)
        .maybeSingle(),
    ]);

    for (const result of [open, sessions, completed, daily]) {
      if (result.error) return toDbFailure(result.error);
    }

    const [openRow] = (open.data ?? []).filter(hasStartedAt);
    const quiz: ResumeQuiz | null = openRow
      ? {
          attemptId: openRow.id,
          title: configTitle(openRow.config),
          answered: countDraftAnswers(openRow.draft_answers),
          total: openRow.total_questions,
          startedAt: openRow.started_at,
        }
      : null;

    const sessionRows = (sessions.data ?? []).filter(hasCompletedAt);
    const latestDeckId = sessionRows.find((s) => (s.deck_ids ?? []).length > 0)?.deck_ids?.[0];
    let deck: ResumeDeck | null = null;
    if (latestDeckId) {
      const { data: deckRow } = await supabase
        .from('flashcard_decks')
        .select('id, name')
        .eq('id', latestDeckId)
        .maybeSingle();
      const session = sessionRows.find((s) => s.deck_ids?.[0] === latestDeckId);
      // A deleted deck (or one the student can no longer read) is simply not offered.
      if (deckRow && session) {
        deck = { deckId: deckRow.id, name: deckRow.name, lastStudiedAt: session.completed_at };
      }
    }

    const completedRows = (completed.data ?? []).filter(hasCompletedAt);
    const gradable = await gradableQuestionCounts(
      supabase,
      completedRows.filter((a) => a.assignment_id === null).map((a) => a.id),
    );
    if (isFailure(gradable)) return gradable;

    const activity: StudentActivityItem[] = [
      ...sessionRows.map((s): StudentActivityItem => ({
        kind: 'flashcards_studied',
        at: s.completed_at,
        title: null,
        cardsStudied: s.cards_studied,
        scorePct: null,
        attemptId: null,
      })),
      ...completedRows.map((a): StudentActivityItem => {
        const isAssignment = a.assignment_id !== null;
        // A teacher may withhold the result of an assignment; the dashboard must not leak it.
        const hidden = isAssignment && a.teacher_assignments?.show_results !== true;
        return {
          kind: isAssignment ? 'assignment_submitted' : 'quiz_completed',
          at: a.completed_at,
          title: a.teacher_assignments?.title ?? configTitle(a.config),
          cardsStudied: null,
          scorePct: hidden ? null : scorePercent(a, gradable.data.get(a.id)),
          attemptId: a.id,
        };
      }),
    ]
      .toSorted((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, ACTIVITY_LIMIT);

    return success({
      resume: { quiz, deck },
      reviewedToday: daily.data?.reviews_count ?? 0,
      activity,
    });
  }
}

export const studentOverviewService = wrapService(
  new StudentOverviewService(createClient),
  'student-overview.service',
);
