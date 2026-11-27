import { isAssessmentClosed } from '@studiq/server/lib/assessment-close';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const READ_PAGE = 500;
const IN_CHUNK = 200;

/**
 * The students an assignment is for, with the targeted groups each one is in (none for a
 * student targeted directly). The publish notification and the „not started” list share it, so
 * the two cannot disagree (#1340). Throws the read error.
 *
 * A target is a raw id the request supplied, so nobody is taken from it as it is: groups are
 * resolved through the assignment's organisation, and everyone must still be a member of it.
 * Otherwise a teacher of two organisations could reach one tenant's people through the
 * other's assignment. The teacher may sit in a targeted group and is left out.
 *
 * `admin` is a service-role client: the caller proves first that the reader may see the result.
 */
export async function readTargetedStudents(
  admin: SupabaseClient<Database>,
  input: { assignmentId: string; organizationId: string; teacherId: string },
): Promise<Map<string, string[]>> {
  const targets: Array<{ group_id: string | null; student_id: string | null }> = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data: page, error } = await admin
      .from('assignment_targets')
      .select('group_id, student_id')
      .eq('assignment_id', input.assignmentId)
      .order('id', { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (error) throw error;
    const pageRows = dbRows(page);
    targets.push(...pageRows);
    if (pageRows.length < READ_PAGE) break;
  }

  const students = new Map<string, string[]>();
  const add = (userId: string, groupId?: string | null) => {
    const groups = students.get(userId) ?? [];
    if (groupId) groups.push(groupId);
    students.set(userId, groups);
  };
  for (const target of targets) {
    if (target.student_id) add(target.student_id);
  }

  const groupIds = [...new Set(targets.flatMap((t) => (t.group_id ? [t.group_id] : [])))];
  for (let g = 0; g < groupIds.length; g += IN_CHUNK) {
    const groupChunk = groupIds.slice(g, g + IN_CHUNK);
    for (let from = 0; ; from += READ_PAGE) {
      const { data: members, error: membersError } = await admin
        .from('group_members')
        .select('user_id, group_id, groups!inner(organization_id)')
        .in('group_id', groupChunk)
        .eq('role', 'member')
        .eq('groups.organization_id', input.organizationId)
        .order('id', { ascending: true })
        .range(from, from + READ_PAGE - 1);
      if (membersError) throw membersError;
      const memberRows = dbRows(members);
      for (const member of memberRows) {
        if (member.user_id) add(member.user_id, member.group_id);
      }
      if (memberRows.length < READ_PAGE) break;
    }
  }

  students.delete(input.teacherId);

  const inOrg = new Set<string>();
  const ids = [...students.keys()];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data: orgMembers, error: orgError } = await admin
      .from('org_members')
      .select('user_id')
      .eq('organization_id', input.organizationId)
      .in('user_id', ids.slice(i, i + IN_CHUNK));
    if (orgError) throw orgError;
    for (const member of dbRows(orgMembers)) inOrg.add(member.user_id);
  }
  for (const id of ids) if (!inOrg.has(id)) students.delete(id);

  return students;
}

async function readGroupNames(
  admin: SupabaseClient<Database>,
  groupIds: string[],
): Promise<ServiceResult<Map<string, string>>> {
  const names = new Map<string, string>();
  for (let i = 0; i < groupIds.length; i += IN_CHUNK) {
    const { data, error } = await admin
      .from('groups')
      .select('id, name')
      .in('id', groupIds.slice(i, i + IN_CHUNK));
    if (error) return toDbFailure(error);
    for (const group of dbRows(data)) names.set(group.id, group.name);
  }
  return success(names);
}

export interface NotStartedStudent {
  userId: string;
  fullName: string | null;
  email: string | null;
  groupIds: string[];
  /** The names of those groups, for the list the teacher reads. */
  groupNames: string[];
}

export interface NotStarted {
  students: NotStartedStudent[];
  /** The run is over, so these students did not take it. */
  closed: boolean;
}

/**
 * The targeted students who have no attempt at all (#1340), by name. A running or expired
 * attempt counts as started. A draft assignment has reached nobody yet, and a cancelled one
 * expects nobody, so both answer an empty list.
 *
 * The caller proves that the reader owns the assignment.
 */
export async function readNotStarted(
  assignmentId: string,
  startedUserIds: ReadonlySet<string>,
): Promise<ServiceResult<NotStarted>> {
  const admin = createServiceClient();
  const { data: assignment, error } = await admin
    .from('teacher_assignments')
    .select('organization_id, created_by, status, closed_at, deadline')
    .eq('id', assignmentId)
    .maybeSingle();
  if (error) return toDbFailure(error);
  const nobody = { students: [], closed: false };
  if (!assignment?.organization_id || !assignment.created_by) return success(nobody);
  if (assignment.status === 'draft' || assignment.status === 'cancelled') return success(nobody);
  const closed = isAssessmentClosed(assignment);

  let targeted: Map<string, string[]>;
  try {
    targeted = await readTargetedStudents(admin, {
      assignmentId,
      organizationId: assignment.organization_id,
      teacherId: assignment.created_by,
    });
  } catch (cause) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the only throws of `readTargetedStudents` are the errors PostgREST returned
    return toDbFailure(cause as PostgrestError);
  }

  const missing = [...targeted.keys()].filter((userId) => !startedUserIds.has(userId));
  const groupNames = await readGroupNames(admin, [
    ...new Set(missing.flatMap((userId) => targeted.get(userId) ?? [])),
  ]);
  if (!groupNames.success) return groupNames;

  const students: NotStartedStudent[] = [];
  for (let i = 0; i < missing.length; i += IN_CHUNK) {
    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('id, full_name, email')
      .in('id', missing.slice(i, i + IN_CHUNK));
    if (profilesError) return toDbFailure(profilesError);
    for (const profile of dbRows(profiles)) {
      students.push({
        userId: profile.id,
        fullName: profile.full_name,
        email: profile.email,
        groupIds: targeted.get(profile.id) ?? [],
        groupNames: (targeted.get(profile.id) ?? []).flatMap(
          (groupId) => groupNames.data.get(groupId) ?? [],
        ),
      });
    }
  }

  return success({
    closed,
    students: students.toSorted((a, b) =>
      (a.fullName ?? a.email ?? '').localeCompare(b.fullName ?? b.email ?? '', 'pl'),
    ),
  });
}
