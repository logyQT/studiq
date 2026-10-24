import { AccountType } from '@studiq/authz';
import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { buildCsv, neutralizeCsvFormula } from '@studiq/server/lib/csv';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { AnswersExportStatus } from '@studiq/server/services/teacher-assignment.service';
import { getLocale, getTranslations } from 'next-intl/server';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * The results view formats dates in the browser's timezone, so the link carries
 * it here. Display-only; an unknown zone falls back to the server timezone
 * (Intl throws a `RangeError` on garbage, which must not become a 500).
 */
function resolveTimeZone(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      const { searchParams } = new URL(req.url);
      const studentId = searchParams.get('studentId') ?? undefined;
      const timeZone = resolveTimeZone(searchParams.get('tz'));

      const response = await teacherAssignmentController.exportAnswers(id, studentId, ctx);
      // Errors keep the JSON envelope (and the `x-error-code` header).
      if (!response.success) return toNextResponse(response);

      const locale = await getLocale();
      const t = await getTranslations({ locale, namespace: 'EduAssignmentResultsPage' });
      const statusLabels: Record<AnswersExportStatus, string> = {
        graded: t('graded'),
        submitted: t('submitted'),
        in_progress: t('in_progress'),
      };

      const csv = buildCsv([
        [t('student'), t('email'), t('score'), t('status'), t('completed_at')],
        ...(response.data ?? []).map((row) => [
          // Student name and e-mail are user-controlled: neutralise spreadsheet
          // formulas (CWE-1236) before the RFC 4180 escaping in `buildCsv`.
          neutralizeCsvFormula(row.studentName ?? t('unknown')),
          neutralizeCsvFormula(row.email ?? ''),
          row.score,
          statusLabels[row.status],
          row.completedAt
            ? new Date(row.completedAt).toLocaleDateString(
                locale,
                timeZone ? { timeZone } : undefined,
              )
            : '-',
        ]),
      ]);

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="assignment-${id}-answers.csv"`,
          // The body is student PII.
          'Cache-Control': 'private, no-store',
        },
      });
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}
