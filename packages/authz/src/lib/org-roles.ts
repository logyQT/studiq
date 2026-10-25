// Organization role primitives.
//
// The role *name* is the stable identifier ("admin", "teacher", "member");
// `org_roles.display_name` is user-editable, so authorization decisions must
// compare against the name. Keeping the literal here means the checkout page
// and the billing service cannot drift apart.

/** Role name that grants organization-wide administration (billing included). */
export const ORG_ADMIN_ROLE = 'admin';

export function isOrgAdminRole(roleName: string | null | undefined): boolean {
  return roleName === ORG_ADMIN_ROLE;
}
