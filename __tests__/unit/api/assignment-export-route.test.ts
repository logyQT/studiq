import { beforeEach, describe, expect, it, vi } from 'vitest';

const exportAnswersMock = vi.fn();
vi.mock('@studiq/server/controllers/teacher-assignment.controller', () => ({
  teacherAssignmentController: {
    exportAnswers: (...args: unknown[]) => exportAnswersMock(...args),
  },
}));

const getLocaleMock = vi.fn();
const getTranslationsMock = vi.fn();
vi.mock('next-intl/server', () => ({
  getLocale: () => getLocaleMock(),
  getTranslations: (opts: unknown) => getTranslationsMock(opts),
}));

let mockCtx: Record<string, unknown>;
vi.mock('@studiq/server/lib/with-auth', () => ({
  withAuth: async (
    _req: unknown,
    handler: (ctx: unknown) => Promise<Response>,
    _options?: unknown,
  ) => handler(mockCtx),
}));

const { GET } =
  await import('@/app/(backend)/api/v1/teacher/assignments/[id]/export-answers/route');

const assignmentId = '3613c5ab-b49f-4e24-b633-cb3b7a215b1e';

const plMessages: Record<string, string> = {
  student: 'Uczeń',
  email: 'E-mail',
  score: 'Wynik',
  status: 'Status',
  completed_at: 'Ukończono',
  unknown: 'Nieznany',
  graded: 'Ocenione',
  submitted: 'Przesłane',
  in_progress: 'W trakcie',
};

function request() {
  return new Request(
    `http://localhost/api/v1/teacher/assignments/${assignmentId}/export-answers`,
  ) as unknown as Parameters<typeof GET>[0];
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/v1/teacher/assignments/[id]/export-answers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = { userId: 'owner-user-id', accountType: 'teacher' };
    getLocaleMock.mockResolvedValue('pl');
    getTranslationsMock.mockImplementation(async () => (key: string) => plMessages[key] ?? key);
  });

  it('streams the results view as a downloadable, BOM-prefixed CSV', async () => {
    exportAnswersMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: [
        {
          studentName: 'Classroom Student',
          email: 'student-classroom@dev.local',
          score: '3/4',
          status: 'submitted',
          completedAt: '2026-10-19T12:00:00.000Z',
        },
        {
          studentName: null,
          email: null,
          score: '-',
          status: 'in_progress',
          completedAt: null,
        },
      ],
    });

    const res = await GET(request(), context(assignmentId));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="assignment-${assignmentId}-answers.csv"`,
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');

    // `Response.text()` strips the BOM while decoding, so check the raw bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);

    const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(body).toBe(
      '\uFEFFUczeń,E-mail,Wynik,Status,Ukończono\n' +
        'Classroom Student,student-classroom@dev.local,3/4,Przesłane,19.10.2026\n' +
        'Nieznany,,-,W trakcie,-',
    );
  });

  it('keeps the JSON error envelope (and trace/error headers) on failure', async () => {
    exportAnswersMock.mockResolvedValue({
      success: false,
      statusCode: 404,
      error: 'NOT_FOUND',
    });

    const res = await GET(request(), context(assignmentId));

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-error-code')).toBe('NOT_FOUND');
    expect(res.headers.get('content-disposition')).toBeNull();
    await expect(res.json()).resolves.toEqual({ success: false, error: 'NOT_FOUND' });
  });
});
