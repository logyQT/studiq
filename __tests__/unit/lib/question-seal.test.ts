import { AccountType, type RequestContext } from '@studiq/authz';
import {
  callerIsLearnerOnAssignment,
  emptySeal,
  heldNotice,
  isWindowOpen,
  sealFor,
  sealedIdFilter,
  type Seal,
} from '@studiq/server/lib/question-seal';
import { describe, expect, it, vi } from 'vitest';

// The pure half of the derived reservation (#1171, R2/R14): the window bounds, the held notice
// and the exclusion filter. The database derivation is covered by `item-seal.test.ts`; the
// target-set half of `sealedItemsFor`/`callerIsLearnerOnAssignment` is driven here through a
// table-shaped service-role mock, so the D-5e1 arms (direct / group-member / org-wide
// learner-profile) are pinned with fixtures where persona and target disagree (R28).

/** The rows each table answers (swapped per test) plus a PostgREST-shaped chain over them. */
const harness = vi.hoisted(() => {
  const db: Record<string, Array<Record<string, unknown>>> = {
    group_members: [],
    assignment_targets: [],
    org_members: [],
    teacher_assignments: [],
    assignment_questions: [],
    questions: [],
  };
  // eslint-disable-next-line unicorn/consistent-function-scoping -- hoisted with the mock it serves
  function table(rows: Array<Record<string, unknown>>) {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: rows.filter((row) => filters.every((filter) => filter(row)))[0] ?? null,
          error: null,
        }),
      single: () =>
        Promise.resolve({
          data: rows.filter((row) => filters.every((filter) => filter(row)))[0] ?? null,
          error: null,
        }),
      then: (resolve: (value: unknown) => void) =>
        resolve({
          data: rows.filter((row) => filters.every((filter) => filter(row))),
          error: null,
        }),
    };
    return chain;
  }
  const serviceClient = { from: (name: string) => table(db[name] ?? []) };
  return { db, table, serviceClient };
});

vi.mock('@studiq/server/lib/supabase/service', () => ({
  createServiceClient: () => harness.serviceClient,
}));

const db = harness.db;

function userClient(): Parameters<typeof callerIsLearnerOnAssignment>[0] {
  const stub = { from: (name: string) => harness.table(db[name] ?? []) };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- partial SupabaseClient test double; stubbing the full surface is impossible
  return stub as unknown as Parameters<typeof callerIsLearnerOnAssignment>[0];
}

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    userId: 'caller-1',
    accountType: AccountType.STUDENT,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: 'org-1',
    orgRoleId: 'role-1',
    groupIds: [],
    groupRoles: {},
    permissionScopes: {},
    ...overrides,
  };
}

function seal(entries: Array<[string, string | null, string | null]>): Seal {
  const value = emptySeal();
  for (const [id, bankId, closesAt] of entries) {
    value.ids.add(id);
    value.bankId.set(id, bankId);
    value.closesAt.set(id, closesAt);
  }
  return value;
}

const FUTURE = () => new Date(Date.now() + 86_400_000).toISOString();

/** A published, open run bound to one item. */
function liveRun(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: 'published',
    start_time: null,
    deadline: FUTURE(),
    closed_at: null,
    ...extra,
  };
}

function resetDb() {
  for (const key of Object.keys(db)) db[key] = [];
}

/** Wires the tables of one targeted, live, item-bound run and returns its question id. */
function wireRun(assignmentId: string, questionId = 'q-1') {
  db.teacher_assignments = [liveRun(assignmentId)];
  db.assignment_questions = [
    {
      assignment_id: assignmentId,
      question_id: questionId,
      withhold_from_review: false,
      released_at: null,
    },
  ];
  db.questions = [{ id: questionId, bank_id: 'bank-1' }];
  return questionId;
}

describe('derived item reservation', () => {
  const now = new Date('2026-11-14T12:00:00Z');

  it('opens the window at start and closes it at the deadline', () => {
    const window = { start_time: '2026-11-14T11:00:00Z', deadline: '2026-11-14T13:00:00Z' };
    expect(isWindowOpen(window, now)).toBe(true);
    expect(isWindowOpen(window, new Date('2026-11-14T10:59:59Z')), 'before the start').toBe(false);
    expect(isWindowOpen(window, new Date('2026-11-14T13:00:00Z')), 'at the close').toBe(false);
  });

  it('treats a missing bound as open, which the publish gate refuses from this release', () => {
    expect(isWindowOpen({}, now)).toBe(true);
    expect(isWindowOpen({ start_time: null, deadline: null }, now)).toBe(true);
    expect(isWindowOpen({ deadline: '2026-11-14T11:00:00Z' }, now)).toBe(false);
  });

  it('counts only the bank’s held items and reports the latest close', () => {
    const notice = heldNotice(
      seal([
        ['q-1', 'bank-1', '2026-11-15T10:00:00Z'],
        ['q-2', 'bank-1', '2026-11-16T10:00:00Z'],
        ['q-3', 'bank-2', '2026-11-30T10:00:00Z'],
      ]),
      'bank-1',
    );
    expect(notice).toEqual({ heldCount: 2, heldUntil: '2026-11-16T10:00:00Z' });
  });

  it('reports no date when a held item has no dated release', () => {
    const notice = heldNotice(seal([['q-1', 'bank-1', null]]), 'bank-1');
    expect(notice).toEqual({ heldCount: 1, heldUntil: null });
  });

  it('reports nothing for a bank with no held item', () => {
    expect(heldNotice(seal([['q-1', 'bank-2', '2026-11-15T10:00:00Z']]), 'bank-1')).toEqual({
      heldCount: 0,
      heldUntil: null,
    });
  });

  it('hands the query an exclusion list, and nothing when the set is empty', () => {
    expect(sealedIdFilter(emptySeal())).toBeNull();
    expect(sealedIdFilter(seal([['q-1', 'bank-1', null]]))).toBe('(q-1)');
  });

  describe('the D-5e1 learner arms (persona and target disagree, R28)', () => {
    it('seals an educator persona who is a direct target', async () => {
      resetDb();
      db.assignment_targets = [{ assignment_id: 'a-1', student_id: 'caller-1' }];
      db.org_members = [
        {
          organization_id: 'org-1',
          user_id: 'caller-1',
          org_roles: { entitlement_profile: 'all' },
        },
      ];
      const questionId = wireRun('a-1');

      const result = await sealFor(ctx({ accountType: AccountType.EDUCATOR }));

      expect(result.success).toBe(true);
      if (result.success) expect([...result.data.ids]).toEqual([questionId]);
    });

    it('seals nothing for a student persona no assignment targets', async () => {
      resetDb();
      db.org_members = [
        {
          organization_id: 'org-1',
          user_id: 'caller-1',
          org_roles: { entitlement_profile: 'learner' },
        },
      ];

      const result = await sealFor(ctx());

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.ids.size).toBe(0);
    });

    it('seals through a group the caller is a member of, but not through one they teach', async () => {
      resetDb();
      db.assignment_targets = [{ assignment_id: 'a-1', group_id: 'g-1' }];
      const questionId = wireRun('a-1');

      db.group_members = [{ group_id: 'g-1', user_id: 'caller-1', role: 'teacher' }];
      const taught = await sealFor(ctx({ accountType: AccountType.EDUCATOR }));
      expect(
        taught.success && taught.data.ids.size,
        'a group teacher is staff of the class, not a learner in it',
      ).toBe(0);

      db.group_members = [{ group_id: 'g-1', user_id: 'caller-1', role: 'member' }];
      const member = await sealFor(ctx());
      expect(member.success).toBe(true);
      if (member.success) expect([...member.data.ids]).toEqual([questionId]);
    });

    it('seals org-wide only in an org whose role for the caller is a learner profile', async () => {
      resetDb();
      db.teacher_assignments = [
        liveRun('a-org', { organization_id: 'org-1', seal_org_wide: true }),
      ];
      db.assignment_questions = [
        {
          assignment_id: 'a-org',
          question_id: 'q-1',
          withhold_from_review: false,
          released_at: null,
        },
      ];
      db.questions = [{ id: 'q-1', bank_id: 'bank-1' }];

      db.org_members = [
        {
          organization_id: 'org-1',
          user_id: 'caller-1',
          org_roles: { entitlement_profile: 'all' },
        },
      ];
      const staff = await sealFor(ctx({ accountType: AccountType.MANAGER }));
      expect(staff.success && staff.data.ids.size, 'org staff are not sealed org-wide').toBe(0);

      db.org_members = [
        {
          organization_id: 'org-1',
          user_id: 'caller-1',
          org_roles: { entitlement_profile: 'learner' },
        },
      ];
      const learner = await sealFor(ctx());
      expect(learner.success).toBe(true);
      if (learner.success) expect([...learner.data.ids]).toEqual(['q-1']);
    });
  });

  describe('callerIsLearnerOnAssignment', () => {
    it('answers false for the author previewing a run they do not target', async () => {
      resetDb();
      const assignment = {
        organization_id: 'org-1',
        seal_org_wide: false,
        assignment_targets: [{ group_id: 'g-1', student_id: null }],
      };
      db.group_members = [{ group_id: 'g-1', user_id: 'author-1', role: 'teacher' }];

      const result = await callerIsLearnerOnAssignment(
        userClient(),
        ctx({
          accountType: AccountType.EDUCATOR,
          userId: 'author-1',
          groupRoles: { 'g-1': 'teacher' },
        }),
        assignment,
      );

      expect(result).toEqual({ success: true, data: false });
    });

    it('answers true for a directly targeted educator persona (R28)', async () => {
      resetDb();
      const assignment = {
        organization_id: 'org-1',
        seal_org_wide: false,
        assignment_targets: [{ group_id: null, student_id: 'caller-1' }],
      };

      const result = await callerIsLearnerOnAssignment(
        userClient(),
        ctx({ accountType: AccountType.EDUCATOR }),
        assignment,
      );

      expect(result).toEqual({ success: true, data: true });
    });

    it('answers true org-wide only for a learner-profile org role', async () => {
      resetDb();
      const assignment = { organization_id: 'org-1', seal_org_wide: true, assignment_targets: [] };

      db.org_members = [
        {
          organization_id: 'org-1',
          user_id: 'caller-1',
          org_roles: { entitlement_profile: 'all' },
        },
      ];
      const staff = await callerIsLearnerOnAssignment(
        userClient(),
        ctx({ accountType: AccountType.MANAGER }),
        assignment,
      );
      expect(staff).toEqual({ success: true, data: false });

      db.org_members = [
        {
          organization_id: 'org-1',
          user_id: 'caller-1',
          org_roles: { entitlement_profile: 'learner' },
        },
      ];
      const learner = await callerIsLearnerOnAssignment(userClient(), ctx(), assignment);
      expect(learner).toEqual({ success: true, data: true });
    });
  });
});
