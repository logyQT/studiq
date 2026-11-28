'use client';

import { useTranslations } from 'next-intl';

export interface NotStartedStudentRow {
  userId: string;
  fullName: string | null;
  email: string | null;
  groupNames: string[];
}

/** The targeted students with no attempt, under the results table (#1340). */
export function NotStartedStudents({
  students,
  targetedCount,
  closed,
}: {
  students: NotStartedStudentRow[];
  /** All students the run targets, started or not. */
  targetedCount: number;
  /** The run is over: these students did not take it. */
  closed: boolean;
}) {
  const t = useTranslations('EduAssignmentResultsPage');
  const title = t(closed ? 'did_not_take' : 'not_started', { count: students.length });

  // With nobody left the section stays, closed: it says why the list is empty.
  return (
    <details open={students.length > 0} className="rounded-lg border" aria-label={title}>
      <summary className="cursor-pointer p-3 text-lg font-semibold tracking-tight">{title}</summary>
      {students.length === 0 ? (
        <p className="border-t p-3 text-sm text-muted-foreground">
          {t(targetedCount > 0 ? 'everyone_started' : 'nobody_targeted')}
        </p>
      ) : (
        <table className="w-full border-t text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              {(['student', 'email', 'groups'] as const).map((column) => (
                <th key={column} className="text-left p-3 font-medium">
                  {t(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.userId} className="border-b last:border-b-0">
                <td className="p-3 font-medium">{student.fullName ?? t('unknown')}</td>
                <td className="p-3 text-muted-foreground">{student.email}</td>
                <td className="p-3 text-muted-foreground">
                  {student.groupNames.length > 0 ? student.groupNames.join(', ') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
