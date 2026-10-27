import type { RequestContext } from '@studiq/authz';
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
  c.is = vi.fn(() => c);
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

/** A chain whose every terminal (await, `.single()`, `.maybeSingle()`) fails. */
function failingChain(error: { code: string; message: string }) {
  const c = chain(null);
  const resolved = { data: null, error };
  c.single = vi.fn().mockResolvedValue(resolved);
  c.maybeSingle = c.single;
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

    it('draws from the caller own questions when there is no active org (#148)', async () => {
      const questionsChain = chain([{ id: 'q-1' }]);

      mock.from
        .mockReturnValueOnce(chain({ id: assignmentId, created_by: userId, organization_id: null }))
        .mockReturnValueOnce(questionsChain)
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValue(chain(null));

      const result = await service.randomize(
        assignmentId,
        { source: 'all', count: 1 },
        { ...ctx, activeOrgId: null },
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ added: 1 });
      expect(questionsChain.eq).toHaveBeenCalledWith('created_by', userId);
      // `.or('organization_id.eq.null,…')` would be rejected by Postgres (22P02 → 500).
      expect(questionsChain.or).not.toHaveBeenCalled();
    });

    it('scopes the pool to the active org and the caller own questions (#148)', async () => {
      const questionsChain = chain([{ id: 'q-1' }]);

      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(questionsChain)
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([{ order_index: 0 }]))
        .mockReturnValue(chain(null));

      const result = await service.randomize(assignmentId, { source: 'all', count: 1 }, ctx);

      expect(result.success).toBe(true);
      expect(questionsChain.or).toHaveBeenCalledWith(
        `organization_id.eq.${orgId},created_by.eq.${userId}`,
      );
      expect(questionsChain.eq).not.toHaveBeenCalledWith('created_by', userId);
    });
  });

  describe('setTargets', () => {
    const owned = () => chain({ id: assignmentId, created_by: userId, organization_id: orgId });

    it('sets group and student targets', async () => {
      mock.from
        .mockReturnValueOnce(owned())
        .mockReturnValueOnce(chain({ organization_id: orgId })) // the assignment's organisation
        .mockReturnValueOnce(chain([{ id: 'g-1' }])) // the group is in it
        .mockReturnValueOnce(chain([{ user_id: 's-1' }])) // and so is the student
        .mockReturnValueOnce(chain(null))
        .mockReturnValue(chain(null));

      const result = await service.setTargets(
        assignmentId,
        { groupIds: ['g-1'], studentIds: ['s-1'] },
        ctx,
      );

      expect(result.success).toBe(true);
    });

    it('refuses a group of another organisation and writes nothing (#235)', async () => {
      mock.from
        .mockReturnValueOnce(owned())
        .mockReturnValueOnce(chain({ organization_id: orgId }))
        .mockReturnValueOnce(chain([])) // no group of this organisation matches
        .mockReturnValue(chain(null));

      const result = await service.setTargets(assignmentId, { groupIds: ['g-foreign'] }, ctx);

      expect(result).toMatchObject({ success: false, error: 'BAD_REQUEST' });
      const tables = mock.from.mock.calls.map(([table]: [string]) => table);
      expect(tables).not.toContain('assignment_targets');
    });

    it('refuses a student who is not in the assignment organisation', async () => {
      mock.from
        .mockReturnValueOnce(owned())
        .mockReturnValueOnce(chain({ organization_id: orgId }))
        .mockReturnValueOnce(chain([{ user_id: 's-1' }])) // only one of the two is a member
        .mockReturnValue(chain(null));

      const result = await service.setTargets(
        assignmentId,
        { studentIds: ['s-1', 's-foreign'] },
        ctx,
      );

      expect(result).toMatchObject({ success: false, error: 'BAD_REQUEST' });
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
        .mockReturnValueOnce(chain(attempt))
        .mockReturnValueOnce(chain([]));

      const result = await service.getStudentAnswers(assignmentId, 'student-1', ctx);

      expect(result.success).toBe(true);
      if (result.success) expect((result.data as { id: string }).id).toBe('attempt-1');
    });

    it('attaches the per-question maximum and null for a removed question (#169)', async () => {
      const gradedAttempt = {
        ...attempt,
        quiz_attempt_questions: [
          { question_id: 'q-open', order_index: 0, question: { id: 'q-open' } },
          { question_id: 'q-gone', order_index: 1, question: { id: 'q-gone' } },
        ],
      };

      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain(gradedAttempt))
        .mockReturnValueOnce(chain([{ question_id: 'q-open', points: 2 }]));

      const result = await service.getStudentAnswers(assignmentId, 'student-1', ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        const rows = (
          result.data as { quiz_attempt_questions: Array<{ max_points: number | null }> }
        ).quiz_attempt_questions;
        expect(rows.map((q) => q.max_points)).toEqual([2, null]);
      }
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

    it('updates existing answer grade and recomputes the attempt score', async () => {
      const attemptChain = chain({ id: 'attempt-1' });
      const questionsChain = chain([
        { question_id: 'q-mcq', points: 1 },
        { question_id: 'q-open', points: 2 },
      ]);
      const answersChain = chain([
        { question_id: 'q-mcq', is_correct: true, teacher_points: null },
        { question_id: 'q-open', is_correct: true, teacher_points: 2 },
      ]);
      const updateChain = chain(null);

      baseSetup();
      mock.from
        .mockReturnValueOnce(attemptChain)
        .mockReturnValueOnce(chain([{ question_id: 'q-open', points: 2 }])) // max points
        .mockReturnValueOnce(chain({ id: 'answer-1' }))
        .mockReturnValueOnce(chain(null)) // student_answers upsert
        .mockReturnValueOnce(questionsChain)
        .mockReturnValueOnce(answersChain)
        .mockReturnValueOnce(updateChain);

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-open', points: 2, feedback: 'Good' },
        ctx,
      );

      expect(result.success).toBe(true);
      // 1 auto-graded point + 2 manual points.
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 3,
        graded_at: expect.any(String),
      });
    });

    it('rejects points above the question maximum (#169)', async () => {
      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValueOnce(chain([{ question_id: 'q-open', points: 2 }]));

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-open', points: 5 },
        ctx,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      // Rejected before any write: ownership, attempt, max-points lookup only.
      expect(mock.from).toHaveBeenCalledTimes(3);
    });

    it('accepts points equal to the question maximum (#169)', async () => {
      const attemptChain = chain({ id: 'attempt-1' });
      const questionsChain = chain([{ question_id: 'q-open', points: 2 }]);
      const answersChain = chain([{ question_id: 'q-open', is_correct: false, teacher_points: 2 }]);
      const updateChain = chain(null);

      baseSetup();
      mock.from
        .mockReturnValueOnce(attemptChain)
        .mockReturnValueOnce(chain([{ question_id: 'q-open', points: 2 }]))
        .mockReturnValueOnce(chain({ id: 'answer-1' }))
        .mockReturnValueOnce(chain(null)) // student_answers update
        .mockReturnValueOnce(questionsChain)
        .mockReturnValueOnce(answersChain)
        .mockReturnValueOnce(updateChain);

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-open', points: 2 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 2,
        graded_at: expect.any(String),
      });
    });

    it('rejects a question that is not part of the assignment (#169)', async () => {
      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValueOnce(chain([{ question_id: 'q-open', points: 2 }]));

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-forged', points: 1 },
        ctx,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
      expect(mock.from).toHaveBeenCalledTimes(3);
    });

    it('clamps legacy teacher points above the maximum when recomputing the score (#169)', async () => {
      const updateChain = chain(null);

      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValueOnce(
          chain([
            { question_id: 'q-open', points: 2 },
            { question_id: 'q-other', points: 3 },
          ]),
        )
        .mockReturnValueOnce(chain({ id: 'answer-1' }))
        .mockReturnValueOnce(chain(null)) // student_answers update
        .mockReturnValueOnce(
          chain([
            { question_id: 'q-open', points: 2 },
            { question_id: 'q-other', points: 3 },
          ]),
        )
        .mockReturnValueOnce(
          chain([
            // Pre-fix row: 5 points on a 2-point question.
            { question_id: 'q-open', is_correct: true, teacher_points: 5 },
            { question_id: 'q-other', is_correct: false, teacher_points: 1 },
          ]),
        )
        .mockReturnValueOnce(updateChain);

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-other', points: 1 },
        ctx,
      );

      expect(result.success).toBe(true);
      // 5 → clamped to 2, plus the new 1 point on q-other.
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 3,
        graded_at: expect.any(String),
      });
    });

    it('lets manual points win over auto correctness (0 points on a correct answer)', async () => {
      const updateChain = chain(null);

      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValueOnce(chain([{ question_id: 'q-mcq', points: 1 }]))
        .mockReturnValueOnce(chain({ id: 'answer-1' }))
        .mockReturnValueOnce(chain(null)) // student_answers upsert
        .mockReturnValueOnce(chain([{ question_id: 'q-mcq', points: 1 }]))
        .mockReturnValueOnce(chain([{ question_id: 'q-mcq', is_correct: true, teacher_points: 0 }]))
        .mockReturnValueOnce(updateChain);

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-mcq', points: 0 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 0,
        graded_at: expect.any(String),
      });
    });

    it('adds 0 for a correct answer whose question is no longer in the assignment', async () => {
      const updateChain = chain(null);

      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValueOnce(chain([{ question_id: 'q-1', points: 1 }]))
        .mockReturnValueOnce(chain({ id: 'answer-1' }))
        .mockReturnValueOnce(chain(null)) // student_answers upsert
        .mockReturnValueOnce(chain([{ question_id: 'q-1', points: 1 }]))
        .mockReturnValueOnce(
          chain([
            { question_id: 'q-1', is_correct: false, teacher_points: 1 },
            { question_id: 'q-gone', is_correct: true, teacher_points: null },
          ]),
        )
        .mockReturnValueOnce(updateChain);

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-1', points: 1 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 1,
        graded_at: expect.any(String),
      });
    });

    it('inserts new answer grade when no existing answer', async () => {
      const updateChain = chain(null);

      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValueOnce(chain([{ question_id: 'q-1', points: 5 }]))
        .mockReturnValueOnce(chain(null)) // no existing answer
        .mockReturnValueOnce(chain(null)) // student_answers insert
        .mockReturnValueOnce(chain([{ question_id: 'q-1', points: 5 }]))
        .mockReturnValueOnce(chain([{ question_id: 'q-1', is_correct: true, teacher_points: 5 }]))
        .mockReturnValueOnce(updateChain);

      const result = await service.gradeAnswer(
        assignmentId,
        'student-1',
        { questionId: 'q-1', points: 5 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 5,
        graded_at: expect.any(String),
      });
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
      const orgRow = { organization_id: orgId };
      const assignmentRow = {
        id: assignmentId,
        title: 'Quiz 1',
        created_by: 'teacher-1',
        organization_id: orgId,
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
        .mockReturnValueOnce(chain([orgRow]))
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

    it('exposes the attempt budget for a completed-but-retakeable assignment (#372)', async () => {
      const attemptRow = {
        assignment_id: assignmentId,
        id: 'attempt-1',
        score: 2,
        total_questions: 2,
        total_points: 2,
        completed_at: '2026-07-13T01:00:00Z',
        started_at: '2026-07-13T00:00:00Z',
      };

      mock.from
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValueOnce(chain([{ organization_id: orgId }]))
        .mockReturnValueOnce(
          chain([
            {
              id: assignmentId,
              title: 'Kartkówka max 2 próby',
              created_by: 'teacher-1',
              organization_id: orgId,
              status: 'published',
              max_attempts: 2,
              assignment_targets: [{ group_id: 'g-1', student_id: null }],
            },
          ]),
        )
        .mockReturnValue(chain([attemptRow]));

      const studentCtx = { ...ctx, groupIds: ['g-1'] };
      const result = await service.listForStudent(studentCtx);

      expect(result.success).toBe(true);
      if (result.success) {
        const [row] = result.data as Array<{
          max_attempts: number;
          attempts_used: number;
          attempt: { id: string };
          last_completed_attempt: { id: string };
        }>;
        expect(row.attempts_used).toBe(1);
        expect(row.attempt.id).toBe('attempt-1');
        expect(row.last_completed_attempt.id).toBe('attempt-1');
      }
    });

    it('does not count a running retake as used and keeps the last completed attempt (#372)', async () => {
      mock.from
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValueOnce(chain([{ organization_id: orgId }]))
        .mockReturnValueOnce(
          chain([
            {
              id: assignmentId,
              title: 'Kartkówka max 2 próby',
              created_by: 'teacher-1',
              organization_id: orgId,
              status: 'published',
              max_attempts: 2,
              assignment_targets: [{ group_id: 'g-1', student_id: null }],
            },
          ]),
        )
        .mockReturnValue(
          chain([
            {
              assignment_id: assignmentId,
              id: 'attempt-1',
              score: 2,
              total_questions: 2,
              total_points: 2,
              completed_at: '2026-07-13T01:00:00Z',
              started_at: '2026-07-13T00:00:00Z',
            },
            {
              assignment_id: assignmentId,
              id: 'attempt-2',
              score: 0,
              total_questions: 2,
              total_points: 2,
              completed_at: null,
              started_at: '2026-07-13T02:00:00Z',
            },
          ]),
        );

      const studentCtx = { ...ctx, groupIds: ['g-1'] };
      const result = await service.listForStudent(studentCtx);

      expect(result.success).toBe(true);
      if (result.success) {
        const [row] = result.data as Array<{
          attempts_used: number;
          attempt: { id: string; completed_at: string | null };
          last_completed_attempt: { id: string };
        }>;
        expect(row.attempts_used).toBe(1);
        expect(row.attempt.id).toBe('attempt-2');
        expect(row.attempt.completed_at).toBeNull();
        expect(row.last_completed_attempt.id).toBe('attempt-1');
      }
    });

    it('reports the exhausted budget after the last allowed attempt (#372)', async () => {
      const completedAttempt = (id: string, at: string) => ({
        assignment_id: assignmentId,
        id,
        score: 2,
        total_questions: 2,
        total_points: 2,
        completed_at: at,
        started_at: at,
      });

      mock.from
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValueOnce(chain([{ organization_id: orgId }]))
        .mockReturnValueOnce(
          chain([
            {
              id: assignmentId,
              title: 'Kartkówka max 2 próby',
              created_by: 'teacher-1',
              organization_id: orgId,
              status: 'published',
              max_attempts: 2,
              assignment_targets: [{ group_id: 'g-1', student_id: null }],
            },
          ]),
        )
        .mockReturnValue(
          chain([
            completedAttempt('attempt-1', '2026-07-13T00:00:00Z'),
            completedAttempt('attempt-2', '2026-07-13T02:00:00Z'),
          ]),
        );

      const studentCtx = { ...ctx, groupIds: ['g-1'] };
      const result = await service.listForStudent(studentCtx);

      expect(result.success).toBe(true);
      if (result.success) {
        const [row] = result.data as Array<{
          attempts_used: number;
          attempt: { id: string };
          last_completed_attempt: { id: string };
        }>;
        expect(row.attempts_used).toBe(2);
        expect(row.attempt.id).toBe('attempt-2');
        expect(row.last_completed_attempt.id).toBe('attempt-2');
      }
    });

    it('picks the newest attempt by started_at regardless of row order (#372)', async () => {
      mock.from
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValueOnce(chain([{ organization_id: orgId }]))
        .mockReturnValueOnce(
          chain([
            {
              id: assignmentId,
              title: 'Kartkówka max 2 próby',
              created_by: 'teacher-1',
              organization_id: orgId,
              status: 'published',
              max_attempts: 2,
              assignment_targets: [{ group_id: 'g-1', student_id: null }],
            },
          ]),
        )
        .mockReturnValue(
          chain([
            {
              assignment_id: assignmentId,
              id: 'attempt-newest',
              score: 0,
              total_questions: 2,
              total_points: 2,
              completed_at: null,
              started_at: '2026-07-13T03:00:00Z',
            },
            {
              assignment_id: assignmentId,
              id: 'attempt-oldest',
              score: 2,
              total_questions: 2,
              total_points: 2,
              completed_at: '2026-07-13T01:00:00Z',
              started_at: '2026-07-13T00:00:00Z',
            },
          ]),
        );

      const studentCtx = { ...ctx, groupIds: ['g-1'] };
      const result = await service.listForStudent(studentCtx);

      expect(result.success).toBe(true);
      if (result.success) {
        const [row] = result.data as Array<{ attempt: { id: string } }>;
        expect(row.attempt.id).toBe('attempt-newest');
      }
    });

    it('returns INTERNAL_SERVER when the attempts query fails (#372)', async () => {
      mock.from
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValueOnce(chain([{ organization_id: orgId }]))
        .mockReturnValueOnce(
          chain([
            {
              id: assignmentId,
              title: 'Kartkówka',
              created_by: 'teacher-1',
              organization_id: orgId,
              status: 'published',
              max_attempts: 2,
              assignment_targets: [{ group_id: 'g-1', student_id: null }],
            },
          ]),
        )
        .mockReturnValue(failingChain({ code: '57014', message: 'attempts query failed' }));

      const studentCtx = { ...ctx, groupIds: ['g-1'] };
      const result = await service.listForStudent(studentCtx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('returns empty array when no assignments', async () => {
      mock.from
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValueOnce(chain([{ organization_id: orgId }]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValue(chain([]));

      const studentCtx = { ...ctx, groupIds: ['g-1'] };
      const result = await service.listForStudent(studentCtx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual([]);
    });

    it('hides an org assignment when the caller has no org_members row, even with a stale group_members row (#249)', async () => {
      const assignmentRow = {
        id: assignmentId,
        title: 'QA MGR-MEM-04 assignment',
        created_by: 'teacher-1',
        organization_id: orgId,
        status: 'published',
        assignment_targets: [{ group_id: 'g-1', student_id: null }],
      };

      mock.from
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([assignmentRow]))
        .mockReturnValue(chain([]));

      const result = await service.listForStudent(ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual([]);
    });

    it('still lists a personal assignment (organization_id null) targeted directly at the student with no orgs', async () => {
      const assignmentRow = {
        id: assignmentId,
        title: 'Personal quiz',
        created_by: 'teacher-1',
        organization_id: null,
        status: 'published',
        assignment_targets: [{ group_id: null, student_id: userId }],
      };

      mock.from
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([assignmentRow]))
        .mockReturnValue(chain([]));

      const result = await service.listForStudent(ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toHaveLength(1);
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

    it('withholds the score while show_results is off, keeping the completion metadata (#374)', async () => {
      mock.from
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(
          chain([
            {
              id: assignmentId,
              title: 'Hidden quiz',
              created_by: 'teacher-1',
              organization_id: null,
              status: 'published',
              show_results: false,
              assignment_targets: [{ group_id: null, student_id: userId }],
            },
          ]),
        )
        .mockReturnValue(
          chain([
            {
              assignment_id: assignmentId,
              id: 'attempt-1',
              score: 3,
              total_questions: 4,
              total_points: 4,
              completed_at: '2026-07-13T01:00:00Z',
              started_at: '2026-07-13T00:00:00Z',
            },
          ]),
        );

      const result = await service.listForStudent(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        const [row] = result.data as Array<{
          attempts_used: number;
          attempt: { id: string; score: number | null };
          last_completed_attempt: { id: string; score: number | null; completed_at: string };
        }>;
        expect(row.attempt.score).toBeNull();
        expect(row.last_completed_attempt.score).toBeNull();
        expect(row.last_completed_attempt.id).toBe('attempt-1');
        expect(row.last_completed_attempt.completed_at).toBe('2026-07-13T01:00:00Z');
        expect(row.attempts_used).toBe(1);
      }
    });

    it('reports the score when show_results is on (#374)', async () => {
      mock.from
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(
          chain([
            {
              id: assignmentId,
              title: 'Visible quiz',
              created_by: 'teacher-1',
              organization_id: null,
              status: 'published',
              show_results: true,
              assignment_targets: [{ group_id: null, student_id: userId }],
            },
          ]),
        )
        .mockReturnValue(
          chain([
            {
              assignment_id: assignmentId,
              id: 'attempt-1',
              score: 3,
              total_questions: 4,
              total_points: 4,
              completed_at: '2026-07-13T01:00:00Z',
              started_at: '2026-07-13T00:00:00Z',
            },
          ]),
        );

      const result = await service.listForStudent(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        const [row] = result.data as Array<{
          last_completed_attempt: { score: number | null };
        }>;
        expect(row.last_completed_attempt.score).toBe(3);
      }
    });
  });

  describe('getForStudent', () => {
    const assignment = {
      id: assignmentId,
      title: 'Quiz 1',
      status: 'published',
      assignment_targets: [{ group_id: null, student_id: userId }],
    };

    it('returns assignment with attempt', async () => {
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValue(
          chain([{ id: 'attempt-1', score: 5, completed_at: '2026-07-13T01:00:00Z' }]),
        );

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.attempt).toBeDefined();
      }
    });

    it('returns the latest attempt instead of failing on multiple rows (#176)', async () => {
      const attemptChain = chain([
        {
          assignment_id: assignmentId,
          id: 'attempt-1',
          score: 3,
          total_questions: 2,
          total_points: 4,
          completed_at: '2026-07-13T01:00:00Z',
          started_at: '2026-07-13T00:00:00Z',
        },
        {
          assignment_id: assignmentId,
          id: 'attempt-2',
          score: 4,
          total_questions: 2,
          total_points: 4,
          completed_at: null,
          started_at: '2026-07-13T02:00:00Z',
        },
      ]);
      mock.from.mockReturnValueOnce(chain(assignment)).mockReturnValueOnce(attemptChain);

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as {
          attempt: { id: string; completed_at: string | null };
          last_completed_attempt: { id: string };
          attempts_used: number;
        };
        expect(data.attempt.id).toBe('attempt-2');
        expect(data.attempt.completed_at).toBeNull();
        expect(data.last_completed_attempt.id).toBe('attempt-1');
        expect(data.attempts_used).toBe(1);
      }
    });

    it('reports an empty attempt budget when the student has no attempts yet (#372)', async () => {
      mock.from.mockReturnValueOnce(chain(assignment)).mockReturnValueOnce(chain([]));

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as {
          attempt: unknown;
          last_completed_attempt: unknown;
          attempts_used: number;
        };
        expect(data.attempt).toBeNull();
        expect(data.last_completed_attempt).toBeNull();
        expect(data.attempts_used).toBe(0);
      }
    });

    it('returns INTERNAL_SERVER when the attempts query fails (#372)', async () => {
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(failingChain({ code: '57014', message: 'attempts query failed' }));

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('allows a student targeted through one of their groups', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ ...assignment, assignment_targets: [{ group_id: 'g-1', student_id: null }] }),
        )
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValue(chain(null));

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(true);
    });

    it('allows the author of the assignment', async () => {
      mock.from
        .mockReturnValueOnce(chain({ ...assignment, created_by: userId, assignment_targets: [] }))
        .mockReturnValue(chain(null));

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND for a student outside the targeted groups (#193)', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ ...assignment, assignment_targets: [{ group_id: 'g-other', student_id: null }] }),
        )
        .mockReturnValueOnce(chain([]));

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('returns NOT_FOUND when the assignment has no targets for the student (#193)', async () => {
      mock.from.mockReturnValueOnce(chain({ ...assignment, assignment_targets: [] }));

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND for an org assignment when the caller is no longer an org member (#249)', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({
            ...assignment,
            organization_id: orgId,
            assignment_targets: [{ group_id: null, student_id: userId }],
          }),
        )
        .mockReturnValueOnce(chain(null));

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('allows an org member targeted through one of their groups (#249)', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({
            ...assignment,
            organization_id: orgId,
            assignment_targets: [{ group_id: 'g-1', student_id: null }],
          }),
        )
        .mockReturnValueOnce(chain({ id: 'member-1' }))
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValue(chain(null));

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND for an org assignment the caller authored after removal (#249)', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({
            ...assignment,
            organization_id: orgId,
            created_by: userId,
            assignment_targets: [],
          }),
        )
        .mockReturnValueOnce(chain(null));

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
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

    it('withholds the score while show_results is off (#374)', async () => {
      mock.from.mockReturnValueOnce(chain({ ...assignment, show_results: false })).mockReturnValue(
        chain([
          {
            assignment_id: assignmentId,
            id: 'attempt-1',
            score: 3,
            total_questions: 4,
            total_points: 4,
            completed_at: '2026-07-13T01:00:00Z',
            started_at: '2026-07-13T00:00:00Z',
          },
        ]),
      );

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as {
          last_completed_attempt: {
            id: string;
            score: number | null;
          };
        };
        expect(data.last_completed_attempt.id).toBe('attempt-1');
        expect(data.last_completed_attempt.score).toBeNull();
      }
    });

    it('reports the score when show_results is on (#374)', async () => {
      mock.from.mockReturnValueOnce(chain({ ...assignment, show_results: true })).mockReturnValue(
        chain([
          {
            assignment_id: assignmentId,
            id: 'attempt-1',
            score: 3,
            total_questions: 4,
            total_points: 4,
            completed_at: '2026-07-13T01:00:00Z',
            started_at: '2026-07-13T00:00:00Z',
          },
        ]),
      );

      const result = await service.getForStudent(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as {
          last_completed_attempt: { score: number | null };
        };
        expect(data.last_completed_attempt.score).toBe(3);
      }
    });
  });

  describe('startAttempt', () => {
    const assignment = {
      id: assignmentId,
      max_attempts: 1,
      shuffle_questions: false,
      shuffle_answers: false,
      assignment_questions: [{ question_id: 'q-1', order_index: 0 }],
      assignment_targets: [{ group_id: null, student_id: userId }],
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

    it('never exposes the answer key in the started attempt payload (#331)', async () => {
      const fullQuestion = { id: 'q-1', content: 'What?', question_answers: [] };
      const questionsChain = chain([fullQuestion]);
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(questionsChain)
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValue(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      const projection = questionsChain.select.mock.calls[0][0] as string;
      expect(projection).not.toContain('*');
      expect(projection).not.toContain('is_correct');
      expect(projection).not.toContain('explanation');
      expect(projection).not.toContain('search_vector');
    });

    it('starts an attempt for a student targeted through a group', async () => {
      const fullQuestion = { id: 'q-1', content: 'What?', question_answers: [] };
      mock.from
        .mockReturnValueOnce(
          chain({
            ...assignment,
            assignment_targets: [{ group_id: 'g-1', student_id: null }],
          }),
        )
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([fullQuestion]))
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValue(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
    });

    it('snapshots the assignment total points on the attempt (#167)', async () => {
      const attemptChain = chain({ id: 'attempt-1' });
      const questions = [
        { question_id: 'q-1', order_index: 0, points: 1 },
        { question_id: 'q-2', order_index: 1, points: 1 },
        { question_id: 'q-3', order_index: 2, points: 1 },
        { question_id: 'q-4', order_index: 3, points: 2 },
      ];
      const fullQuestions = questions.map((q) => ({
        id: q.question_id,
        content: 'What?',
        question_answers: [],
      }));

      mock.from
        .mockReturnValueOnce(chain({ ...assignment, assignment_questions: questions }))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain(fullQuestions))
        .mockReturnValueOnce(attemptChain)
        .mockReturnValue(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      expect(attemptChain.insert).toHaveBeenCalledWith({
        user_id: userId,
        assignment_id: assignmentId,
        score: 0,
        total_questions: 4,
        total_points: 5,
      });
    });

    it('refuses a student outside the targeted groups and creates no attempt (#193)', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({
            ...assignment,
            assignment_targets: [{ group_id: 'g-other', student_id: null }],
          }),
        )
        .mockReturnValueOnce(chain([]));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
      // assignment lookup + group membership lookup only: no attempt / question inserts
      expect(mock.from).toHaveBeenCalledTimes(2);
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

    it('returns NOT_FOUND for an org assignment when the caller is no longer an org member (#249)', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({
            ...assignment,
            organization_id: orgId,
            assignment_targets: [{ group_id: 'g-1', student_id: null }],
          }),
        )
        .mockReturnValueOnce(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
      // assignment lookup + org membership lookup only: no group lookup / attempt insert
      expect(mock.from).toHaveBeenCalledTimes(2);
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

    it('resumes the open attempt instead of inserting a new one (#369)', async () => {
      const openAttempt = {
        id: 'attempt-open',
        assignment_id: assignmentId,
        user_id: userId,
        completed_at: null,
        started_at: '2026-10-23T13:13:26Z',
      };
      const attemptsChain = chain([openAttempt]);
      const resumeQuestionsChain = chain([
        { order_index: 0, question_id: 'q-1', questions: { id: 'q-1', content: 'What?' } },
        { order_index: 1, question_id: 'q-2', questions: { id: 'q-2', content: 'Why?' } },
      ]);
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(attemptsChain)
        .mockReturnValueOnce(resumeQuestionsChain);

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('attempt-open');
        expect(result.data.questions).toHaveLength(2);
      }
      // Read from the attempt's own snapshot, not the assignment's questions.
      expect(resumeQuestionsChain.eq).toHaveBeenCalledWith('attempt_id', 'attempt-open');
      // Only: assignment lookup + attempt lookup + snapshot read. No insert.
      expect(mock.from).toHaveBeenCalledTimes(3);
    });

    it('resumes the open attempt even when max_attempts is already used up (#369)', async () => {
      mock.from
        .mockReturnValueOnce(chain({ ...assignment, max_attempts: 1 }))
        .mockReturnValueOnce(
          chain([{ id: 'attempt-open', completed_at: null, started_at: '2026-10-23T13:13:26Z' }]),
        )
        .mockReturnValueOnce(
          chain([{ order_index: 0, question_id: 'q-1', questions: { id: 'q-1' } }]),
        );

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.id).toBe('attempt-open');
    });

    it('resumes an open attempt even when the assignment questions were emptied (#369)', async () => {
      mock.from
        .mockReturnValueOnce(chain({ ...assignment, assignment_questions: [] }))
        .mockReturnValueOnce(chain([{ id: 'attempt-open', completed_at: null }]))
        .mockReturnValueOnce(
          chain([{ order_index: 0, question_id: 'q-1', questions: { id: 'q-1' } }]),
        );

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.id).toBe('attempt-open');
    });

    it('never ships the draft column or the answer key when resuming (#331, #349)', async () => {
      const resumeQuestionsChain = chain([
        { order_index: 0, question_id: 'q-1', questions: { id: 'q-1', content: 'What?' } },
      ]);
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(
          chain([
            {
              id: 'attempt-open',
              completed_at: null,
              draft_answers: { 'q-1': { selected_answer_id: 'opt-1', text_answer: null } },
            },
          ]),
        )
        .mockReturnValueOnce(resumeQuestionsChain);

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('draft_answers');
        expect(JSON.stringify(result.data)).not.toContain('opt-1');
      }
      const projection = resumeQuestionsChain.select.mock.calls[0][0] as string;
      expect(projection).not.toContain('is_correct');
      expect(projection).not.toContain('explanation');
      expect(projection).not.toContain('search_vector');
    });

    it('still starts a new attempt when every previous attempt is completed (#369)', async () => {
      const attemptChain = chain({ id: 'attempt-2' });
      mock.from
        .mockReturnValueOnce(chain({ ...assignment, max_attempts: 2 }))
        .mockReturnValueOnce(chain([{ id: 'attempt-1', completed_at: '2026-10-23T12:00:00Z' }]))
        .mockReturnValueOnce(chain([{ id: 'q-1', content: 'What?', question_answers: [] }]))
        .mockReturnValueOnce(attemptChain)
        .mockReturnValue(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.id).toBe('attempt-2');
      expect(attemptChain.insert).toHaveBeenCalled();
    });

    it('falls back to the open attempt when a concurrent start wins the insert race (#369)', async () => {
      const racedAttempt = { id: 'attempt-raced', completed_at: null };
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([{ id: 'q-1', content: 'What?', question_answers: [] }]))
        .mockReturnValueOnce(failingChain({ code: '23505', message: 'duplicate key value' }))
        .mockReturnValueOnce(chain(racedAttempt))
        .mockReturnValueOnce(
          chain([{ order_index: 0, question_id: 'q-1', questions: { id: 'q-1' } }]),
        );

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.id).toBe('attempt-raced');
    });

    it('surfaces an attempt lookup error instead of starting a second attempt (#369)', async () => {
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(failingChain({ code: 'XX000', message: 'attempts lookup failed' }));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
      expect(mock.from).toHaveBeenCalledTimes(2);
    });
  });

  describe('exportAnswers', () => {
    const ownedAssignment = () =>
      chain({ id: assignmentId, created_by: userId, organization_id: orgId });

    it('maps every attempt to the results-view row', async () => {
      const attempts = [
        {
          id: 'attempt-1',
          score: 3,
          total_questions: 4,
          total_points: 4,
          completed_at: '2026-10-19T09:00:00.000Z',
          graded_at: '2026-10-20T09:00:00.000Z',
          user: {
            id: 'student-1',
            email: 'student-classroom@dev.local',
            full_name: 'Classroom Student',
          },
        },
        {
          id: 'attempt-2',
          score: 2,
          total_questions: 4,
          total_points: 4,
          completed_at: '2026-10-18T09:00:00.000Z',
          graded_at: null,
          user: {
            id: 'student-2',
            email: 'second@dev.local',
            full_name: 'Second Student',
          },
        },
        {
          id: 'attempt-3',
          score: 0,
          total_questions: 4,
          total_points: null,
          completed_at: null,
          graded_at: null,
          user: null,
        },
      ];

      mock.from.mockReturnValueOnce(ownedAssignment()).mockReturnValueOnce(chain(attempts));

      const result = await service.exportAnswers(assignmentId, undefined, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([
          {
            studentName: 'Classroom Student',
            email: 'student-classroom@dev.local',
            score: '3/4',
            status: 'graded',
            completedAt: '2026-10-19T09:00:00.000Z',
          },
          {
            studentName: 'Second Student',
            email: 'second@dev.local',
            score: '2/4',
            status: 'submitted',
            completedAt: '2026-10-18T09:00:00.000Z',
          },
          {
            studentName: null,
            email: null,
            score: '-',
            status: 'in_progress',
            completedAt: null,
          },
        ]);
      }

      // Ownership check + one attempt query — the assignment/question payload
      // is not read by an export download.
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('falls back to total_questions when total_points is 0 or null', async () => {
      const attempts = [
        {
          id: 'attempt-1',
          score: 5,
          total_questions: 8,
          total_points: 0,
          completed_at: '2026-10-19T09:00:00.000Z',
          graded_at: null,
          user: null,
        },
        {
          id: 'attempt-2',
          score: 3,
          total_questions: 8,
          total_points: null,
          completed_at: '2026-10-18T09:00:00.000Z',
          graded_at: null,
          user: null,
        },
      ];

      mock.from.mockReturnValueOnce(ownedAssignment()).mockReturnValueOnce(chain(attempts));

      const result = await service.exportAnswers(assignmentId, undefined, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.map((row) => row.score)).toEqual(['5/8', '3/8']);
    });

    it('returns an empty list when there are no attempts', async () => {
      mock.from.mockReturnValueOnce(ownedAssignment()).mockReturnValueOnce(chain([]));

      const result = await service.exportAnswers(assignmentId, undefined, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual([]);
    });

    it('filters by studentId when provided', async () => {
      const attemptsChain = chain([]);
      mock.from.mockReturnValueOnce(ownedAssignment()).mockReturnValue(attemptsChain);

      await service.exportAnswers(assignmentId, 'student-1', ctx);

      expect(attemptsChain.eq).toHaveBeenCalledWith('user_id', 'student-1');
    });

    it('orders attempts like the results view, newest first', async () => {
      const attemptsChain = chain([]);
      mock.from.mockReturnValueOnce(ownedAssignment()).mockReturnValueOnce(attemptsChain);

      await service.exportAnswers(assignmentId, undefined, ctx);

      expect(attemptsChain.order).toHaveBeenCalledWith('started_at', { ascending: false });
    });

    it('returns NOT_FOUND when the caller does not own the assignment', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.exportAnswers(assignmentId, undefined, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('maps a database error to a failure', async () => {
      mock.from
        .mockReturnValueOnce(ownedAssignment())
        .mockReturnValueOnce(failingChain({ code: 'XX000', message: 'attempts lookup failed' }));

      const result = await service.exportAnswers(assignmentId, undefined, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
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
      // The student's take page renders this URL as the thumbnail of the attached photo (#338).
      if (result.success) expect(result.data).toEqual({ imageUrl: 'https://example.com/img.png' });
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
