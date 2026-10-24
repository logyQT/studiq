export type GroupMemberRole = 'teacher' | 'member';

/** Row shape returned by `GET /api/v1/organization/groups/:id/addable-members`. */
export interface AddableOrgMember {
  id: string;
  email: string;
  fullName: string | null;
  orgRoleName: string;
}

export interface GroupMemberOption {
  label: string;
  value: string;
  orgRoleName: string;
}

/**
 * Default role a person gets when first added to a group: an org `teacher` is a
 * group teacher, everyone else (member, admin, custom org roles, missing value)
 * starts as a plain member. Mirrors how the seed builds group rosters.
 */
export function defaultGroupRole(orgRoleName: string | null | undefined): GroupMemberRole {
  return orgRoleName === 'teacher' ? 'teacher' : 'member';
}

/**
 * Maps addable org members to multi-select options. `orgRoleName` must survive
 * this step — dropping it is what made every selected teacher a plain member.
 */
export function toGroupMemberOptions(members: AddableOrgMember[]): GroupMemberOption[] {
  return members.map((member) => ({
    label: member.fullName ? `${member.fullName} (${member.email})` : member.email,
    value: member.id,
    orgRoleName: member.orgRoleName,
  }));
}

/**
 * Gives every newly selected person a role derived from their org role while
 * keeping already-known roles (hydrated group members, manager overrides).
 * Unknown ids (e.g. the person left the org) fall back to `'member'`.
 */
export function ensureMemberRoles(
  roles: Record<string, GroupMemberRole>,
  selectedIds: string[],
  options: readonly Pick<GroupMemberOption, 'value' | 'orgRoleName'>[],
): Record<string, GroupMemberRole> {
  const next = { ...roles };
  for (const id of selectedIds) {
    if (!next[id]) {
      next[id] = defaultGroupRole(options.find((option) => option.value === id)?.orgRoleName);
    }
  }
  return next;
}
