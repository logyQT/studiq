import { RequestContext } from '@studiq/authz';
import { TeacherAssignmentService } from '@studiq/server/services/teacher-assignment.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function chain(result: any, count?: number) {
  const resolved =
    count !== undefined ? { data: result, count, error: null } : { data: result, error: null };
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: any = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.or = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.filter = vi.fn(() => c);
  c.limit = vi.fn(() => c);
  c.single = terminal;
  c.maybeSingle = terminal;
  c.insert = vi.fn(() => c);
  c.update = vi.fn(() => c);
  c.delete = vi.fn(() => c);
  c.upsert = vi.fn(() => c);
  c.then = (onfulfilled: any) => Promise.resolve(resolved).then(onfulfilled);
  return c;
}

const userId = 'owner-user-id';
const orgId = '00000000-0000-4000-8000-000000000001';
const assignmentId = 'assignment-1';

const ctx: RequestContext = {
  userId,
  accountType: 'teacher',
  traceId: 't',
  url: '',
  method: 'GET',
  activeOrgId: orgId,
  orgRoleId: 'role-id',
  groupIds: [],
  permissionScopes: {},
};

function ownCtx(overrides?: Partial<RequestContext>): RequestContext {
  return { ...ctx, ...overrides };
}

function withOrgScope(): RequestContext {
  return {
    ...ctx,
    permissionScopes: { 'assignment.read': 'organization', 'assignment.update': 'organization' },
  };
}

describe('TeacherAssignmentService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: TeacherAssignmentService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new TeacherAssignmentService(async () => mock as any);
  });

  function expectOwnershipCheck() {
    expect(mock.from).toHaveBeenNthCalledWith(1, 'teacher_assignments');
  }

  describe('create', () => {
    it('creates an assignment successfully', async () => {
      const dbRow = { id: assignmentId, title: 'Quiz 1', organization_id: orgId };
      mock.from.mockReturnValue(chain(dbRow));

      const result = await service.create(
        {
          title: 'Quiz 1',
          shuffleQuestions: true,
          shuffleAnswers: false,
          showResults: false,
          maxAttempts: 1,
        },
        ctx,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(dbRow);
      }
    });

    it('returns INTERNAL_SERVER on DB error', async () => {
      mock.from.mockReturnValue({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi
              .fn()
              .mockResolvedValue({ data: null, error: { message: 'DB error', code: 'XXX' } }),
          })),
        })),
      });

      const result = await service.create(
        {
          title: 'Quiz 1',
          shuffleQuestions: true,
          shuffleAnswers: false,
          showResults: false,
          maxAttempts: 1,
        },
        ctx,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    const assignment = {
      id: assignmentId,
      title: 'Quiz 1',
      created_by: userId,
      organization_id: orgId,
      assignment_questions: [],
    };

    it('returns assignment when owned by user', async () => {
      mock.from.mockReturnValue(chain(assignment));

      const result = await service.getById(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(assignment);
    });

    it('returns assignment for org scope', async () => {
      const otherUserAssignment = { ...assignment, created_by: 'other-user' };
      mock.from.mockReturnValue(chain(otherUserAssignment));

      const result = await service.getById(assignmentId, withOrgScope());

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(otherUserAssignment);
    });

    it('returns NOT_FOUND when no assignment', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.getById(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });

    it('returns FORBIDDEN when not owner and no org scope', async () => {
      mock.from.mockReturnValue(
        chain({ ...assignment, created_by: 'other-user', organization_id: orgId }),
      );

      const result = await service.getById(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN when org scope but wrong org', async () => {
      mock.from.mockReturnValue(
        chain({ ...assignment, created_by: 'other-user', organization_id: 'other-org' }),
      );

      const result = await service.getById(assignmentId, withOrgScope());

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('FORBIDDEN');
    });

    it('returns INTERNAL_SERVER on DB error', async () => {
      mock.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          })),
        })),
      });

      const result = await service.getById(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('list', () => {
    const assignments = [
      { id: assignmentId, title: 'Quiz 1', created_by: userId, organization_id: orgId },
    ];

    it('returns assignments for org scope', async () => {
      mock.from.mockReturnValue(chain(assignments));

      const result = await service.list(withOrgScope());

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toHaveLength(1);
    });

    it('returns assignments filtered by owner', async () => {
      mock.from.mockReturnValue(chain(assignments));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toHaveLength(1);
    });

    it('returns empty array when no assignments', async () => {
      mock.from.mockReturnValue(chain([]));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual([]);
    });

    it('returns INTERNAL_SERVER on DB error', async () => {
      mock.from.mockReturnValue({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          })),
        })),
      });

      const result = await service.list(ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('update', () => {
    it('updates assignment successfully', async () => {
      const updated = { id: assignmentId, title: 'Updated Title' };
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(chain(updated));

      const result = await service.update(assignmentId, { title: 'Updated Title' }, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(updated);
      expectOwnershipCheck();
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.update(assignmentId, { title: 'Updated' }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });

    it('returns INTERNAL_SERVER on DB error', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue({
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
              })),
            })),
          })),
        });

      const result = await service.update(assignmentId, { title: 'Updated' }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('delete', () => {
    it('deletes assignment successfully', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(chain(null));

      const result = await service.delete(assignmentId, ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.delete(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });

    it('returns INTERNAL_SERVER on DB error', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue({
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          })),
        });

      const result = await service.delete(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('publish', () => {
    it('publishes assignment with deadline', async () => {
      const published = { id: assignmentId, status: 'published' };
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(chain(published));

      const result = await service.publish(
        assignmentId,
        '2026-07-20T00:00:00.000Z',
        undefined,
        ctx,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('published');
    });

    it('publishes assignment without deadline', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(chain({ id: assignmentId, status: 'published' }));

      const result = await service.publish(assignmentId, undefined, undefined, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('published');
    });

    it('publishes assignment with startTime', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(
          chain({ id: assignmentId, status: 'published', start_time: '2026-09-01T08:00:00.000Z' }),
        );

      const result = await service.publish(
        assignmentId,
        undefined,
        '2026-09-01T08:00:00.000Z',
        ctx,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.start_time).toBe('2026-09-01T08:00:00.000Z');
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.publish(assignmentId, undefined, undefined, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('unpublish', () => {
    it('unpublishes a published assignment', async () => {
      const draft = { id: assignmentId, status: 'draft' };
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain({ id: assignmentId, status: 'published' }))
        .mockReturnValue(chain(draft));

      const result = await service.unpublish(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('draft');
    });

    it('returns BAD_REQUEST when assignment is already draft', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(chain({ id: assignmentId, status: 'draft' }));

      const result = await service.unpublish(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('BAD_REQUEST');
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.unpublish(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('addQuestions', () => {
    it('adds new questions', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValue(chain(null));

      const result = await service.addQuestions(assignmentId, { questionIds: ['q-1', 'q-2'] }, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ added: 2 });
    });

    it('skips already-added questions', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain([{ question_id: 'q-1' }]))
        .mockReturnValueOnce(chain([{ order_index: 0 }]))
        .mockReturnValue(chain(null));

      const result = await service.addQuestions(assignmentId, { questionIds: ['q-1', 'q-2'] }, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ added: 1 });
    });

    it('returns success with 0 when all already exist', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain([{ question_id: 'q-1' }]));

      const result = await service.addQuestions(assignmentId, { questionIds: ['q-1'] }, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ added: 0 });
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.addQuestions(assignmentId, { questionIds: ['q-1'] }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('removeQuestion', () => {
    it('removes question successfully', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(chain(null));

      const result = await service.removeQuestion(assignmentId, 'q-1', ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.removeQuestion(assignmentId, 'q-1', ctx);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('randomize', () => {
    it('selects random questions from bank source', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain([{ id: 'q-1' }, { id: 'q-2' }]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValue(chain(null));

      const result = await service.randomize(
        assignmentId,
        { source: 'bank', sourceId: 'bank-1', count: 2 },
        ctx,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ added: 2 });
    });

    it('returns success with 0 when no available questions', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([{ order_index: 0 }]))
        .mockReturnValue(chain(null));

      const result = await service.randomize(assignmentId, { source: 'all', count: 5 }, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ added: 0 });
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.randomize(assignmentId, { source: 'all', count: 5 }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('setTargets', () => {
    it('sets group and student targets', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain(null))
        .mockReturnValue(chain(null));

      const result = await service.setTargets(
        assignmentId,
        { groupIds: ['g-1'], studentIds: ['s-1'] },
        ctx,
      );

      expect(result.success).toBe(true);
    });

    it('clears targets when no groups or students', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(chain(null));

      const result = await service.setTargets(assignmentId, {}, ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.setTargets(assignmentId, { groupIds: ['g-1'] }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('getResults', () => {
    const attempts = [
      {
        id: 'attempt-1',
        assignment_id: assignmentId,
        user_id: 'student-1',
        score: 8,
        total_questions: 10,
        user: { id: 'student-1', email: 's@t.com', full_name: 'Student' },
      },
    ];

    it('returns attempts for assignment', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(chain(attempts));

      const result = await service.getResults(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toHaveLength(1);
    });

    it('returns empty array when no attempts', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(chain([]));

      const result = await service.getResults(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual([]);
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.getResults(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('getStudentAnswers', () => {
    const attempt = {
      id: 'attempt-1',
      assignment_id: assignmentId,
      user_id: 'student-1',
      quiz_attempt_questions: [],
      quiz_answers: [],
      assignment_answer_images: [],
    };

    it('returns student answers', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(chain(attempt));

      const result = await service.getStudentAnswers(assignmentId, 'student-1', ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.id).toBe('attempt-1');
    });

    it('returns NOT_FOUND when no attempt', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValue(chain(null));

      const result = await service.getStudentAnswers(assignmentId, 'student-1', ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.getStudentAnswers(assignmentId, 'student-1', ctx);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('gradeAnswer', () => {
    const baseSetup = () => {
      mock.from.mockReturnValueOnce(
        chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
      );
    };

    it('updates existing answer grade', async () => {
      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValueOnce(chain({ id: 'answer-1' }))
        .mockReturnValue(chain(null))
        .mockReturnValue(chain(null));

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-1', points: 5, feedback: 'Good' },
        ctx,
      );

      expect(result.success).toBe(true);
    });

    it('inserts new answer grade when no existing answer', async () => {
      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValue(chain(null))
        .mockReturnValue(chain(null));

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-1', points: 5 },
        ctx,
      );

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when no attempt', async () => {
      baseSetup();
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-1', points: 3 },
        ctx,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-1', points: 3 },
        ctx,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('listForStudent', () => {
    it('returns published assignments for student', async () => {
      const groupRow = { group_id: 'g-1' };
      const assignmentRow = {
        id: assignmentId,
        title: 'Quiz 1',
        created_by: 'teacher-1',
        status: 'published',
        assignment_targets: [{ group_id: 'g-1', student_id: null }],
      };
      const attemptRow = {
        assignment_id: assignmentId,
        id: 'a-1',
        score: 5,
        total_questions: 10,
        completed_at: null,
        started_at: '2026-07-13T00:00:00Z',
      };

      mock.from
        .mockReturnValueOnce(chain([groupRow]))
        .mockReturnValueOnce(chain([assignmentRow]))
        .mockReturnValue(chain([attemptRow]));

      const studentCtx = { ...ctx, groupIds: ['g-1'] };
      const result = await service.listForStudent(studentCtx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].attempt).toBeDefined();
      }
    });

    it('returns empty array when no assignments', async () => {
      mock.from
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValue(chain([]));

      const studentCtx = { ...ctx, groupIds: ['g-1'] };
      const result = await service.listForStudent(studentCtx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual([]);
    });

    it('returns INTERNAL_SERVER on group query error', async () => {
      mock.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        })),
      });

      const result = await service.listForStudent(ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getForStudent', () => {
    const assignment = {
      id: assignmentId,
      title: 'Quiz 1',
      status: 'published',
      assignment_targets: [],
    };

    it('returns assignment with attempt', async () => {
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValue(chain({ id: 'attempt-1', score: 5 }));

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.attempt).toBeDefined();
      }
    });

    it('returns NOT_FOUND when no assignment', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });

    it('returns INTERNAL_SERVER on DB error', async () => {
      mock.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
            })),
          })),
        })),
      });

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('startAttempt', () => {
    const assignment = {
      id: assignmentId,
      max_attempts: 1,
      shuffle_questions: false,
      shuffle_answers: false,
      assignment_questions: [{ question_id: 'q-1', order_index: 0 }],
    };

    it('starts a new attempt successfully', async () => {
      const fullQuestion = { id: 'q-1', content: 'What?', question_answers: [] };
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([fullQuestion]))
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValue(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('attempt-1');
        expect(result.data.questions).toHaveLength(1);
      }
    });

    it('returns RATE_LIMITED when max attempts reached', async () => {
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(chain([{ id: 'a-1', completed_at: '2026-07-13T00:00:00Z' }]));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('RATE_LIMITED');
    });

    it('returns NOT_FOUND when no questions', async () => {
      mock.from
        .mockReturnValueOnce(chain({ ...assignment, assignment_questions: [] }))
        .mockReturnValueOnce(chain([]));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when assignment is not published', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });

    it('shuffles questions when shuffle_questions is true', async () => {
      const shuffleAssignment = {
        ...assignment,
        shuffle_questions: true,
        assignment_questions: [
          { question_id: 'q-1', order_index: 0 },
          { question_id: 'q-2', order_index: 1 },
        ],
      };
      mock.from
        .mockReturnValueOnce(chain(shuffleAssignment))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(
          chain([
            { id: 'q-1', content: 'Q1', question_answers: [] },
            { id: 'q-2', content: 'Q2', question_answers: [] },
          ]),
        )
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValue(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.questions).toHaveLength(2);
    });
  });

  describe('uploadImage', () => {
    it('uploads image successfully', async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1', user_id: userId }))
        .mockReturnValue(chain(null));

      const result = await service.uploadImage(
        assignmentId,
        'attempt-1',
        'q-1',
        'https://example.com/img.png',
        ctx,
      );

      expect(result.success).toBe(true);
    });

    it('returns FORBIDDEN when attempt belongs to another user', async () => {
      mock.from.mockReturnValueOnce(chain({ id: 'attempt-1', user_id: 'other-student' }));

      const result = await service.uploadImage(
        assignmentId,
        'attempt-1',
        'q-1',
        'https://example.com/img.png',
        ctx,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('FORBIDDEN');
    });

    it('returns NOT_FOUND when attempt does not exist', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.uploadImage(
        assignmentId,
        'nonexistent',
        'q-1',
        'https://example.com/img.png',
        ctx,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });
});
