/**
 * Whether an org-scoped read may fire yet (#1125).
 *
 * `/api/v1/organization/*` scopes itself from the `active_org_id` cookie (#186),
 * and `useOrgs()` is what establishes it: it resolves the memberships and, on a
 * cold load, selects the first one through `POST /api/v1/me/orgs/switch`. A read
 * sent before that lands is cookie-less, and the API answers 403
 * (`!ctx.activeOrgId` in the organization-member, group, org-role and seat
 * services), so a hard-loaded `/manage` deep link rendered the error card with
 * zero rows until "try again" re-sent the request. Callers also key their effect
 * on the resolved id, so an org switch reloads the new org's rows.
 */
export function canLoadOrgScoped(activeOrgId: string | null | undefined): boolean {
  return !!activeOrgId;
}
