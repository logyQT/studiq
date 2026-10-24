export type GroupMemberRole = 'teacher' | 'member';

/**
 * Default role a person gets when first added to a group: an org `teacher` is a
 * group teacher, everyone else (member, admin, custom org roles, missing value)
 * starts as a plain member. Mirrors how the seed builds group rosters.
 */
export function defaultGroupRole(orgRoleName: string | null | undefined): GroupMemberRole {
  return orgRoleName === 'teacher' ? 'teacher' : 'member';
}
