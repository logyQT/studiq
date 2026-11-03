import {
  groupStudentAssignments,
  type StudentAssignmentAttemptState,
  type StudentAssignmentTiming,
} from '@/lib/assignment-attempts';

export type UpcomingAssignment<T> = T & { inProgress: boolean };

function deadlineTime(a: StudentAssignmentTiming): number {
  return a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
}

/**
 * The assignments a student can still do, soonest deadline first: those with a running attempt
 * and those not started. Scheduled (not open yet), closed and finished ones are left out, and an
 * assignment without a deadline comes after every dated one. Bucketing is the one the
 * assignments page uses, so the dashboard and the list always agree.
 */
export function upcomingAssignments<
  T extends StudentAssignmentAttemptState & StudentAssignmentTiming,
>(assignments: readonly T[], now: Date, limit = 4): Array<UpcomingAssignment<T>> {
  const { inProgress, pending } = groupStudentAssignments(assignments, now);
  const open = [
    ...inProgress.map((a) => ({ ...a, inProgress: true })),
    ...pending.map((a) => ({ ...a, inProgress: false })),
  ];

  return open.toSorted((a, b) => deadlineTime(a) - deadlineTime(b)).slice(0, limit);
}
