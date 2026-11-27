import { readNotStarted } from '@studiq/server/lib/assignment-recipients';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));

interface Rows {
  assignment: {
    organization_id: string | null;
    created_by: string;
    status: string;
    closed_at?: string | null;
    deadline?: string | null;
  } | null;
  targets: Array<{ group_id: string | null; student_id: string | null }>;
  members: Array<{ user_id: string; group_id: string }>;
  orgMembers: string[];
  /** A table whose read fails. */
  failing?: string;
}

/** A service client that answers each table from `rows`, whatever the filters. */
function client(rows: Rows) {
  const answers: Record<string, (ids: string[]) => unknown> = {
    teacher_assignments: () => rows.assignment,
    assignment_targets: () => rows.targets,
    group_members: () => rows.members,
    groups: (ids) => ids.map((id) => ({ id, name: `Group ${id}` })),
    org_members: (ids) =>
      ids.filter((id) => rows.orgMembers.includes(id)).map((user_id) => ({ user_id })),
    profiles: (ids) =>
      ids.map((id) => ({ id, full_name: `Name ${id}`, email: `${id}@example.test` })),
  };
  const queried: string[] = [];
  const from = (table: string) => {
    queried.push(table);
    let ids: string[] = [];
    const result = () =>
      rows.failing === table
        ? { data: null, error: { code: 'XX000', message: 'connection reset' } }
        : { data: answers[table]?.(ids) ?? null, error: null };
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range: () => query,
      in: (column: string, values: string[]) => {
        if (column === 'user_id' || column === 'id') ids = values;
        return query;
      },
      maybeSingle: () => Promise.resolve(result()),
      then: <T>(resolve: (value: ReturnType<typeof result>) => T) =>
        Promise.resolve(result()).then(resolve),
    };
    return query;
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- partial SupabaseClient test double
  vi.mocked(createServiceClient).mockReturnValue({ from } as unknown as ReturnType<
    typeof createServiceClient
  >);
  return queried;
}

/** Two groups that share `both`, one student targeted directly, and the teacher in a group. */
const classRows = (): Rows => ({
  assignment: { organization_id: 'org-1', created_by: 'teacher', status: 'published' },
  targets: [
    { group_id: 'g-1', student_id: null },
    { group_id: 'g-2', student_id: null },
    { group_id: null, student_id: 'direct' },
  ],
  members: [
    { user_id: 'anna', group_id: 'g-1' },
    { user_id: 'both', group_id: 'g-1' },
    { user_id: 'both', group_id: 'g-2' },
    { user_id: 'teacher', group_id: 'g-2' },
    { user_id: 'gone', group_id: 'g-2' },
  ],
  orgMembers: ['anna', 'both', 'direct', 'teacher'],
});

const read = async (started: string[] = []) => {
  const result = await readNotStarted('a-1', new Set(started));
  if (!result.success) throw new Error(result.error);
  return result.data;
};
const missing = async (started: string[] = []) => (await read(started))?.students;

/** Whether a published run with these bounds is reported as over. */
async function closedBy(bounds: { closed_at?: string; deadline?: string }) {
  const rows = classRows();
  rows.assignment = {
    organization_id: 'org-1',
    created_by: 'teacher',
    status: 'published',
    ...bounds,
  };
  client(rows);
  const result = await readNotStarted('a-1', new Set());
  if (!result.success) throw new Error(result.error);
  return result.data?.closed;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readNotStarted (#1340)', () => {
  it('lists each targeted student without an attempt once, by name', async () => {
    client(classRows());

    // `anna` has started; the teacher and a student who left the organisation never count.
    expect(await missing(['anna'])).toEqual([
      {
        userId: 'both',
        fullName: 'Name both',
        email: 'both@example.test',
        groupIds: ['g-1', 'g-2'],
        groupNames: ['Group g-1', 'Group g-2'],
      },
      {
        userId: 'direct',
        fullName: 'Name direct',
        email: 'direct@example.test',
        groupIds: [],
        groupNames: [],
      },
    ]);
  });

  it('says the run is over from its close or its deadline, not from the list', async () => {
    expect(await closedBy({ deadline: '2999-01-01T00:00:00Z' })).toBe(false);
    expect(await closedBy({ deadline: '2000-01-01T00:00:00Z' })).toBe(true);
    expect(await closedBy({ closed_at: '2000-01-01T00:00:00Z' })).toBe(true);
  });

  it('is empty once everyone targeted has an attempt, and reads no profile', async () => {
    const queried = client(classRows());

    expect(await read(['anna', 'both', 'direct'])).toMatchObject({ students: [], targeted: 3 });
    expect(queried).not.toContain('profiles');
  });

  it('tells a run with no targeted student from one where everyone has started', async () => {
    // The only member left is the teacher, who never counts.
    client({
      ...classRows(),
      targets: [{ group_id: 'g-2', student_id: null }],
      members: [{ user_id: 'teacher', group_id: 'g-2' }],
    });

    expect(await read()).toMatchObject({ students: [], targeted: 0 });
  });

  it.each(['draft', 'cancelled'])('has no list for a %s assignment', async (status) => {
    const rows = classRows();
    rows.assignment = { organization_id: 'org-1', created_by: 'teacher', status };
    const queried = client(rows);

    // `null`, not an empty list: an empty one reads as „everyone has started”.
    expect(await read()).toBeNull();
    expect(queried).toEqual(['teacher_assignments']);
  });

  it('has no list without an organisation to check membership against', async () => {
    const rows = classRows();
    rows.assignment = { organization_id: null, created_by: 'teacher', status: 'published' };
    const queried = client(rows);

    expect(await read()).toBeNull();
    expect(queried).toEqual(['teacher_assignments']);
  });

  it.each([
    'teacher_assignments',
    'assignment_targets',
    'group_members',
    'org_members',
    'groups',
    'profiles',
  ])('fails, and does not answer a shorter list, when %s cannot be read', async (table) => {
    client({ ...classRows(), failing: table });

    const result = await readNotStarted('a-1', new Set());

    expect(result).toMatchObject({ success: false, error: 'INTERNAL_SERVER' });
  });
});
