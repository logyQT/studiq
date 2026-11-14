import { AccountType, type RequestContext } from '@studiq/authz';
import { TeacherAssignmentService } from '@studiq/server/services/teacher-assignment.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { asJson } from '#test/helpers/json';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { firstCall, firstRecorded } from '#test/mocks/recorded';

// The assignment pages render the key through the service-role reader (#1170); these tests
// cover the ownership/shape logic, so the reader answers an empty map.
vi.mock('@studiq/server/lib/question-keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@studiq/server/lib/question-keys')>()),
  readQuestionKeys: vi.fn(() => Promise.resolve(new Map())),
}));

// The frozen snapshot's key column is service-role only (#1171); the ownership/shape tests never
// need its value. Slice 2 moved the link rows and the reader snapshots behind the same service-role
// seam, so each test declares the links it serves here.
type AssignmentLink = import('@studiq/server/lib/assignment-snapshot').AssignmentLink;
type QuestionSnapshot = import('@studiq/server/lib/assignment-snapshot').QuestionSnapshot;

const linkRows = vi.hoisted(() => ({ rows: [] as AssignmentLink[] }));
const resumedQuestions = vi.hoisted(() => ({ rows: [] as QuestionSnapshot[] }));
vi.mock('@studiq/server/lib/assignment-snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@studiq/server/lib/assignment-snapshot')>()),
  readAssignmentSnapshotKeys: vi.fn(() => Promise.resolve(new Map())),
  readAssignmentSnapshots: vi.fn(() => Promise.resolve({ success: true, data: new Map() })),
  readAssignmentLinks: vi.fn(() => Promise.resolve({ success: true, data: linkRows.rows })),
  // Resume serves the attempt's own frozen items; each test states them here.
  readAttemptQuestions: vi.fn(() =>
    Promise.resolve({ success: true, data: resumedQuestions.rows }),
  ),
  writeAssignmentSnapshots: vi.fn(() => Promise.resolve({ success: true, data: 1 })),
}));

/** Cross-class exposure is derived from the database in production; these tests state the count. */
const exposureState = vi.hoisted(() => ({ openItemCount: 0, outsideStudentCount: 0 }));
vi.mock('@studiq/server/lib/assignment-exposure', () => ({
  assessExposure: vi.fn(() => Promise.resolve({ success: true, data: exposureState })),
}));

type QueryResult = { data: unknown; error: unknown; count?: number };
type QueryChain = {
  select: Mock<(columns: string) => QueryChain>;
  eq: Mock<(...args: unknown[]) => QueryChain>;
  in: Mock<(...args: unknown[]) => QueryChain>;
  or: Mock<(...args: unknown[]) => QueryChain>;
  order: Mock<(...args: unknown[]) => QueryChain>;
  filter: Mock<(...args: unknown[]) => QueryChain>;
  is: Mock<(...args: unknown[]) => QueryChain>;
  limit: Mock<(...args: unknown[]) => QueryChain>;
  single: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  maybeSingle: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  insert: Mock<(...args: unknown[]) => QueryChain>;
  update: Mock<(...args: unknown[]) => QueryChain>;
  delete: Mock<(...args: unknown[]) => QueryChain>;
  upsert: Mock<(...args: unknown[]) => QueryChain>;
  then: Promise<QueryResult>['then'];
};

function chain(result: unknown, count?: number) {
  const resolved: QueryResult =
    count !== undefined ? { data: result, count, error: null } : { data: result, error: null };
  const promise = Promise.resolve(resolved);
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: QueryChain = {
    select: vi.fn(() => c),
    eq: vi.fn(() => c),
    in: vi.fn(() => c),
    or: vi.fn(() => c),
    order: vi.fn(() => c),
    filter: vi.fn(() => c),
    is: vi.fn(() => c),
    limit: vi.fn(() => c),
    single: terminal,
    maybeSingle: terminal,
    insert: vi.fn(() => c),
    update: vi.fn(() => c),
    delete: vi.fn(() => c),
    upsert: vi.fn(() => c),
    then: promise.then.bind(promise),
  };
  return c;
}

/**
 * `quiz_attempts` stub with PostgREST cardinality: equality filters that match
 * more than one row make `.single()`/`.maybeSingle()` fail with PGRST116, which
 * is what a student's second attempt does to a read filtered by
 * `(assignment_id, user_id)` (#1062).
 */
function attemptRowsChain(rows: Array<Record<string, unknown>>) {
  const c = chain(rows);
  const filters: Array<[string, unknown]> = [];
  c.eq = vi.fn((column: string, value: unknown) => {
    filters.push([column, value]);
    return c;
  });
  const resolve = () => {
    const found = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
    if (found.length > 1) {
      return Promise.resolve({
        data: null,
        error: {
          code: 'PGRST116',
          message: 'JSON object requested, multiple (or no) rows returned',
        },
      });
    }
    return Promise.resolve({ data: found[0] ?? null, error: null });
  };
  c.single = vi.fn(resolve);
  c.maybeSingle = c.single;
  return c;
}

/** A chain whose every terminal (await, `.single()`, `.maybeSingle()`) fails. */
function failingChain(failure: { code: string; message: string }) {
  const c = chain(null);
  const resolved: QueryResult = { data: null, error: failure };
  const promise = Promise.resolve(resolved);
  c.single = vi.fn().mockResolvedValue(resolved);
  c.maybeSingle = c.single;
  c.then = promise.then.bind(promise);
  return c;
}

/** `expect.any` is typed `any`; hoisted to `unknown` so expected objects stay typed. */
const anyTimestamp: unknown = expect.any(String);

/** A frozen snapshot row as `assignment_questions` stores it (#1171). */
function frozen(id: string, content = 'What?') {
  return { id, content, type: 'mcq', question_answers: [] };
}

/** The `assignment_questions` rows `readAssignmentSnapshots` reads for a set of ids. */
function snapshotRows(ids: string[]) {
  return chain(ids.map((id) => ({ question_id: id, snapshot: frozen(id), snapshot_version: 1 })));
}

/** Any future close: the publish gate only needs the window to be well-formed. */
const PUBLISH_DEADLINE = new Date(Date.now() + 86_400_000).toISOString();

const userId = 'owner-user-id';

/** ownedClient → the stored row → targets → items → (the update). */
function publishFixture(
  mock: ReturnType<typeof mockSupabaseClient>,
  stored: Record<string, unknown> = {},
) {
  const before = {
    status: 'draft',
    start_time: null,
    deadline: PUBLISH_DEADLINE,
    max_attempts: 1,
    organization_id: orgId,
    ...stored,
  };
  const update = chain({ id: assignmentId, status: 'published' });
  mock.from
    .mockReturnValueOnce(chain({ id: assignmentId, created_by: userId, organization_id: orgId }))
    .mockReturnValueOnce(chain(before))
    .mockReturnValueOnce(chain([{ group_id: 'g-1', student_id: null }]))
    .mockReturnValueOnce(chain([{ question_id: 'q-1' }]))
    .mockReturnValueOnce(update);
  return update;
}
const orgId = '00000000-0000-4000-8000-000000000001';
const assignmentId = 'assignment-1';

const ctx: RequestContext = {
  userId,
  accountType: AccountType.EDUCATOR,
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

const owned = () => chain({ id: assignmentId, created_by: userId, organization_id: orgId });
const ownedAssignment = () =>
  chain({ id: assignmentId, created_by: userId, organization_id: orgId });

describe('TeacherAssignmentService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: TeacherAssignmentService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new TeacherAssignmentService(() => Promise.resolve(mock));
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
      status: 'draft',
      assignment_questions: [],
    };

    it('returns assignment when owned by user', async () => {
      mock.from.mockReturnValue(chain(assignment));

      const result = await service.getById(assignmentId, ctx);

      expect(result.success).toBe(true);
      // A draft also carries the composer's cross-class forecast (R3); it is counts only.
      if (result.success)
        expect(result.data).toEqual({
          ...assignment,
          exposure: { openItemCount: 0, outsideStudentCount: 0 },
        });
    });

    it('returns assignment for org scope', async () => {
      const otherUserAssignment = { ...assignment, created_by: 'other-user' };
      mock.from.mockReturnValue(chain(otherUserAssignment));

      const result = await service.getById(assignmentId, withOrgScope());

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.data).toEqual({
          ...otherUserAssignment,
          exposure: { openItemCount: 0, outsideStudentCount: 0 },
        });
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
      const dbError = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } });
      mock.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: dbError, maybeSingle: dbError })),
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
    beforeEach(() => {
      exposureState.openItemCount = 0;
      exposureState.outsideStudentCount = 0;
    });

    it('publishes a complete run and records the seal scope', async () => {
      const update = publishFixture(mock);

      const result = await service.publish(
        assignmentId,
        { acknowledgeExposure: true, sealOrgWide: false },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(update.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'published', seal_org_wide: false }),
      );
    });

    it('refuses a run with no items, naming the field', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(
          chain({ status: 'draft', start_time: null, deadline: PUBLISH_DEADLINE, max_attempts: 1 }),
        )
        .mockReturnValueOnce(chain([{ group_id: 'g-1', student_id: null }]))
        .mockReturnValueOnce(chain([]));

      const result = await service.publish(assignmentId, { acknowledgeExposure: true }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('UNPROCESSABLE_ENTITY');
        expect(result.details?.map((issue) => issue.path.join('.'))).toContain('items');
      }
    });

    it('refuses a second publish of an already published run', async () => {
      publishFixture(mock, { status: 'published' });

      const result = await service.publish(assignmentId, { acknowledgeExposure: true }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('ASSESSMENT_ALREADY_PUBLISHED');
    });

    it('requires the acknowledgement for cross-class exposure', async () => {
      exposureState.openItemCount = 2;
      exposureState.outsideStudentCount = 5;
      publishFixture(mock);

      const refused = await service.publish(assignmentId, {}, ctx);

      expect(refused.success).toBe(false);
      if (!refused.success) expect(refused.error).toBe('EXPOSURE_ACK_REQUIRED');
    });

    it('publishes an exposed run once it is sealed for the whole organisation', async () => {
      exposureState.openItemCount = 2;
      const update = publishFixture(mock);

      const result = await service.publish(assignmentId, { sealOrgWide: true }, ctx);

      expect(result.success).toBe(true);
      expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ seal_org_wide: true }));
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.publish(assignmentId, {}, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('unpublish', () => {
    it('withdraws a scheduled run to draft', async () => {
      const draft = { id: assignmentId, status: 'draft' };
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain({ status: 'published', start_time: '2999-01-01T00:00:00.000Z' }))
        .mockReturnValue(chain(draft));

      const result = await service.unpublish(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('draft');
    });

    it('refuses to withdraw a live run', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(
          chain({ status: 'published', start_time: '2026-01-01T00:00:00.000Z' }),
        );

      const result = await service.unpublish(assignmentId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('ASSESSMENT_LIVE');
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
        .mockReturnValueOnce(chain({ status: 'draft' })) // not live
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([{ id: 'q-1' }, { id: 'q-2' }]))
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
        .mockReturnValueOnce(chain({ status: 'draft' })) // not live
        .mockReturnValueOnce(chain([{ question_id: 'q-1' }]))
        .mockReturnValueOnce(chain([{ id: 'q-2' }]))
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
        .mockReturnValueOnce(chain({ status: 'draft' })) // not live
        .mockReturnValueOnce(chain([{ question_id: 'q-1' }]));

      const result = await service.addQuestions(assignmentId, { questionIds: ['q-1'] }, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ added: 0 });
    });

    it('refuses to change a published assignment (#1171 R13)', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain({ status: 'published' }));

      const result = await service.addQuestions(assignmentId, { questionIds: ['q-1'] }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('ASSESSMENT_LIVE');
      // Ownership + status only: nothing is written.
      expect(mock.from).toHaveBeenCalledTimes(2);
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
        .mockReturnValueOnce(chain({ status: 'draft' })) // not live
        .mockReturnValue(chain(null));

      const result = await service.removeQuestion(assignmentId, 'q-1', ctx);

      expect(result.success).toBe(true);
    });

    it('refuses to remove an item from a published assignment (#1171 R13)', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain({ status: 'published' }));

      const result = await service.removeQuestion(assignmentId, 'q-1', ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('ASSESSMENT_LIVE');
      expect(mock.from).toHaveBeenCalledTimes(2);
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
        .mockReturnValueOnce(chain({ status: 'draft' })) // not live
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
        .mockReturnValueOnce(chain({ status: 'draft' })) // not live
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([{ order_index: 0 }]))
        .mockReturnValue(chain(null));

      const result = await service.randomize(assignmentId, { source: 'all', count: 5 }, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ added: 0 });
    });

    it('refuses to randomize into a published assignment (#1171 R13)', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(chain({ status: 'published' }));

      const result = await service.randomize(assignmentId, { source: 'all', count: 5 }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('ASSESSMENT_LIVE');
      expect(mock.from).toHaveBeenCalledTimes(2);
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
        .mockReturnValueOnce(chain({ status: 'draft' })) // not live
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
        .mockReturnValueOnce(chain({ status: 'draft' })) // not live
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
    it('sets group and student targets', async () => {
      mock.from
        .mockReturnValueOnce(owned())
        .mockReturnValueOnce(chain({ organization_id: orgId })) // the assignment's organisation
        .mockReturnValueOnce(chain(null, 1)) // the group is in it
        .mockReturnValueOnce(chain(null, 1)) // and so is the student
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
        .mockReturnValueOnce(chain(null, 0)) // no group of this organisation matches
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
        .mockReturnValueOnce(chain(null, 1)) // only one of the two is a member
        .mockReturnValue(chain(null));

      const result = await service.setTargets(
        assignmentId,
        { studentIds: ['s-1', 's-foreign'] },
        ctx,
      );

      expect(result).toMatchObject({ success: false, error: 'BAD_REQUEST' });
    });

    it('accepts a direct student target on a personal assignment (no organisation)', async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: assignmentId, created_by: userId, organization_id: null }))
        .mockReturnValueOnce(chain({ organization_id: null }))
        .mockReturnValue(chain(null));

      const result = await service.setTargets(assignmentId, { studentIds: ['s-1'] }, ctx);

      expect(result.success).toBe(true);
      const tables = mock.from.mock.calls.map(([table]: [string]) => table);
      expect(tables).toContain('assignment_targets');
    });

    it("accepts a group target on a personal assignment when it is one of the caller's groups", async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: assignmentId, created_by: userId, organization_id: null }))
        .mockReturnValueOnce(chain({ organization_id: null }))
        .mockReturnValueOnce(chain([{ organization_id: orgId }])) // the caller's organisations
        .mockReturnValueOnce(chain(null, 1)) // the group is in one of them
        .mockReturnValue(chain(null));

      const result = await service.setTargets(assignmentId, { groupIds: ['g-1'] }, ctx);

      expect(result.success).toBe(true);
    });

    it('refuses a group of another organisation on a personal assignment', async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: assignmentId, created_by: userId, organization_id: null }))
        .mockReturnValueOnce(chain({ organization_id: null }))
        .mockReturnValueOnce(chain([{ organization_id: orgId }]))
        .mockReturnValueOnce(chain(null, 0))
        .mockReturnValue(chain(null));

      const result = await service.setTargets(assignmentId, { groupIds: ['g-foreign'] }, ctx);

      expect(result).toMatchObject({ success: false, error: 'BAD_REQUEST' });
      const tables = mock.from.mock.calls.map(([table]: [string]) => table);
      expect(tables).not.toContain('assignment_targets');
    });

    it('checks a long student list in chunks and sums the matches', async () => {
      const studentIds = Array.from({ length: 250 }, (_, i) => `s${i}`);
      mock.from
        .mockReturnValueOnce(owned())
        .mockReturnValueOnce(chain({ organization_id: orgId }))
        .mockReturnValueOnce(chain(null, 200))
        .mockReturnValueOnce(chain(null, 50))
        .mockReturnValue(chain(null));

      const result = await service.setTargets(assignmentId, { studentIds }, ctx);

      expect(result.success).toBe(true);
      expect(mock.from.mock.calls.filter(([table]) => table === 'org_members')).toHaveLength(2);
    });

    it('refuses targets when the assignment read fails instead of treating it as personal', async () => {
      mock.from
        .mockReturnValueOnce(owned())
        .mockReturnValueOnce(failingChain({ code: 'PGRST116', message: 'no rows' }))
        .mockReturnValue(chain(null));

      const result = await service.setTargets(assignmentId, { studentIds: ['s-1'] }, ctx);

      expect(result).toMatchObject({ success: false, error: 'BAD_REQUEST' });
      const tables = mock.from.mock.calls.map(([table]: [string]) => table);
      expect(tables).not.toContain('assignment_targets');
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
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]));

      const result = await service.getStudentAnswers(assignmentId, 'attempt-1', ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(asJson<{ id: string }>(result.data).id).toBe('attempt-1');
    });

    it('loads the requested attempt when the student has two attempts (#1062)', async () => {
      const attempts = attemptRowsChain([
        {
          ...attempt,
          id: 'attempt-1',
          quiz_answers: [{ id: 'answer-1', question_id: 'q-open' }],
        },
        {
          ...attempt,
          id: 'attempt-2',
          quiz_answers: [{ id: 'answer-2', question_id: 'q-open' }],
        },
      ]);

      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(attempts)
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]));

      const result = await service.getStudentAnswers(assignmentId, 'attempt-2', ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        const loaded = asJson<{ id: string; quiz_answers: Array<{ id: string }> }>(result.data);
        expect(loaded.id).toBe('attempt-2');
        expect(loaded.quiz_answers.map((answer) => answer.id)).toEqual(['answer-2']);
      }
      // The attempt id alone must not resolve: `assignment_id` is the IDOR guard.
      expect(attempts.eq).toHaveBeenCalledWith('assignment_id', assignmentId);
    });

    it('returns NOT_FOUND for an attempt of another assignment (#1062)', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
        )
        .mockReturnValueOnce(
          attemptRowsChain([
            { ...attempt, id: 'attempt-foreign', assignment_id: 'assignment-other' },
          ]),
        )
        .mockReturnValue(chain([]));

      const result = await service.getStudentAnswers(assignmentId, 'attempt-foreign', ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
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
        .mockReturnValueOnce(chain([{ question_id: 'q-open', points: 2 }]))
        .mockReturnValueOnce(chain([]));

      const result = await service.getStudentAnswers(assignmentId, 'attempt-1', ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        const rows = asJson<{ quiz_attempt_questions: Array<{ max_points: number | null }> }>(
          result.data,
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

      const result = await service.getStudentAnswers(assignmentId, 'attempt-1', ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when ownership check fails', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.getStudentAnswers(assignmentId, 'attempt-1', ctx);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
    });
  });

  const baseSetup = () => {
    mock.from.mockReturnValueOnce(
      chain({ id: assignmentId, created_by: userId, organization_id: orgId }),
    );
  };

  describe('gradeAnswer', () => {
    it('grades only the requested attempt when the student has two attempts (#1062)', async () => {
      const attemptUpdate = chain(null);
      const attempts = attemptRowsChain([
        { id: 'attempt-1', assignment_id: assignmentId, user_id: 'student-1', graded_at: null },
        { id: 'attempt-2', assignment_id: assignmentId, user_id: 'student-1', graded_at: null },
      ]);

      baseSetup();
      mock.from
        .mockReturnValueOnce(attempts)
        .mockReturnValueOnce(chain([{ question_id: 'q-open', points: 2 }]))
        .mockReturnValueOnce(chain({ id: 'answer-2' }))
        .mockReturnValueOnce(chain(null)) // student_answers update
        .mockReturnValueOnce(chain([{ question_id: 'q-open', points: 2 }]))
        .mockReturnValueOnce(
          chain([{ question_id: 'q-open', is_correct: false, teacher_points: 2 }]),
        )
        .mockReturnValueOnce(attemptUpdate);

      const result = await service.gradeAnswer(
        assignmentId,
        'attempt-2',
        { questionId: 'q-open', points: 2 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(attemptUpdate.update).toHaveBeenCalledWith({
        score: 2,
        graded_at: anyTimestamp,
      });
      expect(attemptUpdate.eq).toHaveBeenCalledWith('id', 'attempt-2');
      // The attempt id alone must not resolve: `assignment_id` is the IDOR guard.
      expect(attempts.eq).toHaveBeenCalledWith('assignment_id', assignmentId);
    });

    it('does not grade an attempt of another assignment (#1062)', async () => {
      baseSetup();
      mock.from
        .mockReturnValueOnce(
          attemptRowsChain([
            {
              id: 'attempt-foreign',
              assignment_id: 'assignment-other',
              user_id: 'student-1',
              graded_at: null,
            },
          ]),
        )
        .mockReturnValue(chain([]));

      const result = await service.gradeAnswer(
        assignmentId,
        'attempt-foreign',
        { questionId: 'q-open', points: 2 },
        ctx,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
      // Ownership + the attempt read only: nothing was graded or scored.
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('maps an attempt-read failure instead of reporting NOT_FOUND', async () => {
      baseSetup();
      mock.from
        .mockReturnValueOnce(failingChain({ code: 'XX000', message: 'connection reset' }))
        .mockReturnValue(chain([]));

      const result = await service.gradeAnswer(
        assignmentId,
        'attempt-1',
        { questionId: 'q-open', points: 1 },
        ctx,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('updates existing answer grade and recomputes the attempt score', async () => {
      const attemptChain = chain({ id: 'attempt-1', user_id: 'student-1' });
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
        'attempt-1',
        { questionId: 'q-open', points: 2, feedback: 'Good' },
        ctx,
      );

      expect(result.success).toBe(true);
      // 1 auto-graded point + 2 manual points.
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 3,
        graded_at: anyTimestamp,
      });
    });

    it('rejects points above the question maximum (#169)', async () => {
      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1', user_id: 'student-1' }))
        .mockReturnValueOnce(chain([{ question_id: 'q-open', points: 2 }]));

      const result = await service.gradeAnswer(
        assignmentId,
        'attempt-1',
        { questionId: 'q-open', points: 5 },
        ctx,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      // Rejected before any write: ownership, attempt, max-points lookup only.
      expect(mock.from).toHaveBeenCalledTimes(3);
    });

    it('accepts points equal to the question maximum (#169)', async () => {
      const attemptChain = chain({ id: 'attempt-1', user_id: 'student-1' });
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
        'attempt-1',
        { questionId: 'q-open', points: 2 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 2,
        graded_at: anyTimestamp,
      });
    });

    it('rejects a question that is not part of the assignment (#169)', async () => {
      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1', user_id: 'student-1' }))
        .mockReturnValueOnce(chain([{ question_id: 'q-open', points: 2 }]));

      const result = await service.gradeAnswer(
        assignmentId,
        'attempt-1',
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
        .mockReturnValueOnce(chain({ id: 'attempt-1', user_id: 'student-1' }))
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
        'attempt-1',
        { questionId: 'q-other', points: 1 },
        ctx,
      );

      expect(result.success).toBe(true);
      // 5 → clamped to 2, plus the new 1 point on q-other.
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 3,
        graded_at: anyTimestamp,
      });
    });

    it('lets manual points win over auto correctness (0 points on a correct answer)', async () => {
      const updateChain = chain(null);

      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1', user_id: 'student-1' }))
        .mockReturnValueOnce(chain([{ question_id: 'q-mcq', points: 1 }]))
        .mockReturnValueOnce(chain({ id: 'answer-1' }))
        .mockReturnValueOnce(chain(null)) // student_answers upsert
        .mockReturnValueOnce(chain([{ question_id: 'q-mcq', points: 1 }]))
        .mockReturnValueOnce(chain([{ question_id: 'q-mcq', is_correct: true, teacher_points: 0 }]))
        .mockReturnValueOnce(updateChain);

      const result = await service.gradeAnswer(
        assignmentId,
        'attempt-1',
        { questionId: 'q-mcq', points: 0 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 0,
        graded_at: anyTimestamp,
      });
    });

    it('adds 0 for a correct answer whose question is no longer in the assignment', async () => {
      const updateChain = chain(null);

      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1', user_id: 'student-1' }))
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
        'attempt-1',
        { questionId: 'q-1', points: 1 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 1,
        graded_at: anyTimestamp,
      });
    });

    it('inserts new answer grade when no existing answer', async () => {
      const updateChain = chain(null);

      baseSetup();
      mock.from
        .mockReturnValueOnce(chain({ id: 'attempt-1', user_id: 'student-1' }))
        .mockReturnValueOnce(chain([{ question_id: 'q-1', points: 5 }]))
        .mockReturnValueOnce(chain(null)) // no existing answer
        .mockReturnValueOnce(chain(null)) // student_answers insert
        .mockReturnValueOnce(chain([{ question_id: 'q-1', points: 5 }]))
        .mockReturnValueOnce(chain([{ question_id: 'q-1', is_correct: true, teacher_points: 5 }]))
        .mockReturnValueOnce(updateChain);

      const result = await service.gradeAnswer(
        assignmentId,
        'attempt-1',
        { questionId: 'q-1', points: 5 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith({
        score: 5,
        graded_at: anyTimestamp,
      });
    });

    it('returns NOT_FOUND when no attempt', async () => {
      baseSetup();
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.gradeAnswer(
        assignmentId,
        'attempt-1',
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
        'attempt-1',
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
        const rows = asJson<Array<{ attempt: unknown }>>(result.data);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.attempt).toBeDefined();
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
        const row = firstRecorded(
          asJson<
            Array<{
              max_attempts: number;
              attempts_used: number;
              attempt: { id: string };
              last_completed_attempt: { id: string };
            }>
          >(result.data),
        );
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
        const row = firstRecorded(
          asJson<
            Array<{
              attempts_used: number;
              attempt: { id: string; completed_at: string | null };
              last_completed_attempt: { id: string };
            }>
          >(result.data),
        );
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
        const row = firstRecorded(
          asJson<
            Array<{
              attempts_used: number;
              attempt: { id: string };
              last_completed_attempt: { id: string };
            }>
          >(result.data),
        );
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
        const row = firstRecorded(
          asJson<Array<{ attempt: { id: string } }>>(result.data),
          'the student attempt row',
        );
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
        const row = firstRecorded(
          asJson<
            Array<{
              attempts_used: number;
              attempt: { id: string; score: number | null };
              last_completed_attempt: { id: string; score: number | null; completed_at: string };
            }>
          >(result.data),
        );
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
        const row = firstRecorded(
          asJson<
            Array<{
              last_completed_attempt: { score: number | null };
            }>
          >(result.data),
        );
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
        const data = asJson<{
          attempt: { id: string; completed_at: string | null };
          last_completed_attempt: { id: string };
          attempts_used: number;
        }>(result.data);
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
        const data = asJson<{
          attempt: unknown;
          last_completed_attempt: unknown;
          attempts_used: number;
        }>(result.data);
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
      const dbError = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } });
      mock.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ single: dbError, maybeSingle: dbError })),
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
        const data = asJson<{
          last_completed_attempt: {
            id: string;
            score: number | null;
          };
        }>(result.data);
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
        const data = asJson<{
          last_completed_attempt: { score: number | null };
        }>(result.data);
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
      assignment_questions: [
        {
          question_id: 'q-1',
          order_index: 0,
          points: 1,
          snapshot: frozen('q-1'),
          snapshot_version: 1,
        },
      ],
      assignment_targets: [{ group_id: null, student_id: userId }],
    };
    // The service reads the item set through the service-role seam; the fixture above is the
    // default set every test in this block starts from.
    beforeEach(() => {
      linkRows.rows = assignment.assignment_questions;
    });
    it('starts a new attempt successfully', async () => {
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValue(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('attempt-1');
        expect(result.data.questions).toHaveLength(1);
      }
    });

    it('serves the frozen snapshot, never the live item or its key (#1171)', async () => {
      const assignmentChain = chain(assignment);
      mock.from
        .mockReturnValueOnce(assignmentChain)
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValue(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      const projection = firstCall(assignmentChain.select)[0];
      expect(projection).not.toContain('snapshot_key');
      if (result.success) {
        const payload = JSON.stringify(result.data.questions);
        expect(payload).not.toContain('is_correct');
        expect(payload).not.toContain('explanation');
        // The published version travels with the payload so a mismatch is visible.
        expect(payload).toContain('"snapshot_version":1');
      }
    });

    it('starts an attempt for a student targeted through a group', async () => {
      mock.from
        .mockReturnValueOnce(
          chain({
            ...assignment,
            assignment_targets: [{ group_id: 'g-1', student_id: null }],
          }),
        )
        .mockReturnValueOnce(chain([{ group_id: 'g-1' }]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain({ id: 'attempt-1' }))
        .mockReturnValue(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
    });

    it('snapshots the assignment total points on the attempt (#167)', async () => {
      const attemptChain = chain({ id: 'attempt-1' });
      const questions = [
        {
          question_id: 'q-1',
          order_index: 0,
          points: 1,
          snapshot: frozen('q-1'),
          snapshot_version: 1,
        },
        {
          question_id: 'q-2',
          order_index: 1,
          points: 1,
          snapshot: frozen('q-2'),
          snapshot_version: 1,
        },
        {
          question_id: 'q-3',
          order_index: 2,
          points: 1,
          snapshot: frozen('q-3'),
          snapshot_version: 1,
        },
        {
          question_id: 'q-4',
          order_index: 3,
          points: 2,
          snapshot: frozen('q-4'),
          snapshot_version: 1,
        },
      ];

      linkRows.rows = questions;
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(chain([]))
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
      linkRows.rows = [];
      mock.from.mockReturnValueOnce(chain(assignment)).mockReturnValueOnce(chain([]));

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
          {
            question_id: 'q-1',
            order_index: 0,
            points: 1,
            snapshot: frozen('q-1', 'Q1'),
            snapshot_version: 1,
          },
          {
            question_id: 'q-2',
            order_index: 1,
            points: 1,
            snapshot: frozen('q-2', 'Q2'),
            snapshot_version: 1,
          },
        ],
      };
      linkRows.rows = shuffleAssignment.assignment_questions;
      mock.from
        .mockReturnValueOnce(chain(shuffleAssignment))
        .mockReturnValueOnce(chain([]))
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
      resumedQuestions.rows = [frozen('q-1'), frozen('q-2')];
      mock.from.mockReturnValueOnce(chain(assignment)).mockReturnValueOnce(attemptsChain);

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('attempt-open');
        expect(result.data.questions).toHaveLength(2);
      }
      // Only: assignment lookup + attempt lookup. No insert.
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('resumes the open attempt even when max_attempts is already used up (#369)', async () => {
      resumedQuestions.rows = [frozen('q-1')];
      mock.from
        .mockReturnValueOnce(chain({ ...assignment, max_attempts: 1 }))
        .mockReturnValueOnce(chain([{ id: 'attempt-open', completed_at: null }]));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.id).toBe('attempt-open');
    });

    it('resumes an open attempt even when the assignment questions were emptied (#369)', async () => {
      linkRows.rows = [];
      resumedQuestions.rows = [frozen('q-1')];
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(chain([{ id: 'attempt-open', completed_at: null }]));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.id).toBe('attempt-open');
    });

    it('never ships the draft column or the answer key when resuming (#331, #349)', async () => {
      resumedQuestions.rows = [frozen('q-1')];
      mock.from.mockReturnValueOnce(chain(assignment)).mockReturnValueOnce(
        chain([
          {
            id: 'attempt-open',
            assignment_id: assignmentId,
            completed_at: null,
            draft_answers: { 'q-1': { selected_answer_id: 'opt-1', text_answer: null } },
          },
        ]),
      );

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('draft_answers');
        expect(JSON.stringify(result.data)).not.toContain('opt-1');
      }
      // The reader payload itself carries no key material; the service-role projection that
      // feeds it is covered by the integration suite.
      expect(JSON.stringify(result.data)).not.toContain('is_correct');
      expect(JSON.stringify(result.data)).not.toContain('snapshot_key');
    });

    it('still starts a new attempt when every previous attempt is completed (#369)', async () => {
      const attemptChain = chain({ id: 'attempt-2' });
      mock.from
        .mockReturnValueOnce(chain({ ...assignment, max_attempts: 2 }))
        .mockReturnValueOnce(chain([{ id: 'attempt-1', completed_at: '2026-10-23T12:00:00Z' }]))
        .mockReturnValueOnce(attemptChain)
        .mockReturnValue(chain(null));

      const result = await service.startAttempt(assignmentId, ctx);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.id).toBe('attempt-2');
      expect(attemptChain.insert).toHaveBeenCalled();
    });

    it('falls back to the open attempt when a concurrent start wins the insert race (#369)', async () => {
      const racedAttempt = {
        id: 'attempt-raced',
        assignment_id: assignmentId,
        completed_at: null,
      };
      mock.from
        .mockReturnValueOnce(chain(assignment))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(failingChain({ code: '23505', message: 'duplicate key value' }))
        .mockReturnValueOnce(chain(racedAttempt))
        .mockReturnValueOnce(chain([{ question_id: 'q-1' }]))
        .mockReturnValueOnce(snapshotRows(['q-1']));

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
