import { expect, type APIRequestContext } from '@playwright/test';
import { json } from '#test/helpers/json';
import { createQaSupabase } from '@qa/fixtures/qa-db';

/**
 * Per-attempt identity for a case-owned invitee.
 *
 * CI runs the suite with `retries: 2` against **one** seeded tenant, and a
 * `--repeat-each` run replays the same test again in the same tenant. A spec
 * that invites a fixed address therefore collides with its own earlier attempt:
 * the second invitation is a duplicate pending row, the strict-mode locator
 * resolves two rows, and an account created by an interrupted attempt blocks a
 * new registration.
 *
 * Folding both indices into the address gives every attempt a never-used
 * address. Pass real `TestInfo` fields (`retry`, `repeatEachIndex`).
 */
export function attemptSuffix(info: { retry: number; repeatEachIndex: number }): string {
  return `r${info.retry}e${info.repeatEachIndex}`;
}

interface Invitation {
  id: string;
  email: string;
  createdAt: string;
}

interface Member {
  id: string;
  email: string;
  /** `org_members.joined_at` — when the account joined this organization. */
  joinedAt: string | null;
}

export interface ResetInviteeOptions {
  /** The organization whose memberships are cleaned (the manager's active org). */
  organizationId: string;
  /**
   * Only rows created strictly before this instant are removed. Pass the
   * instant the attempt started, read from the **database** clock
   * (`qaDbNow()` in `qa/fixtures/qa-db.ts`) — the same clock that writes
   * `invitations.created_at` and `org_members.joined_at`.
   *
   * Without it, a `--repeat-each` run with several workers lets two attempts of
   * the same spec run in parallel: the later one would delete the earlier one's
   * freshly created invitation/membership mid-test. The cutoff keeps each
   * attempt's cleanup to the *previous* attempts' leftovers.
   */
  createdBefore?: Date;
}

/**
 * Return the case's invitee slice of the tenant to its seeded state: cancel the
 * case's pending invitations and remove its invitee memberships.
 *
 * `matches` selects the addresses the case owns — a prefix for a derived
 * address (`qa+<hash>`), or an exact set for seeded invitee accounts. Only those
 * rows are touched.
 *
 * Called at the **start** of an attempt, not only in `afterAll`: a retry must
 * start clean even when the previous attempt died before its hooks ran. It also
 * frees the plan's member slots, so retries cannot push the organization over
 * capacity and turn an invitation into a plan-limit failure.
 *
 * Needs the manager's session on `request` (API context or `page.request`).
 */
export async function resetInviteeState(
  request: APIRequestContext,
  matches: (email: string) => boolean,
  options: ResetInviteeOptions,
): Promise<void> {
  const createdBefore = options.createdBefore?.getTime();
  // An unknown timestamp is never treated as "old": with a cutoff set, deleting
  // an unaged row could remove a concurrent attempt's work.
  const isOld = (timestamp: string | null | undefined): boolean => {
    if (createdBefore === undefined) return true;
    if (!timestamp) return false;
    return new Date(timestamp).getTime() < createdBefore;
  };

  const invitesRes = await request.get('/api/v1/organization/invites');
  expect(invitesRes.ok(), 'GET /api/v1/organization/invites').toBe(true);
  const invites = (await json<{ data?: Invitation[] }>(invitesRes)).data ?? [];
  for (const invite of invites.filter((entry) => matches(entry.email) && isOld(entry.createdAt))) {
    const removed = await request.delete(`/api/v1/organization/invites/${invite.id}`);
    expect([200, 404], `DELETE invitation ${invite.email}`).toContain(removed.status());
  }

  // The list endpoint reports the *profile's* `created_at`, not when the account
  // joined this org, so read the membership clock from the database. It is only
  // used to age rows; the deletion still goes through the product endpoint.
  const db = createQaSupabase();
  const { data: membershipRows, error } = await db
    .from('org_members')
    .select('user_id, joined_at')
    .eq('organization_id', options.organizationId);
  if (error) throw new Error(`resetInviteeState: read memberships: ${error.message}`);

  const userIds = (membershipRows ?? []).map((row) => row.user_id);
  const emailById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await db
      .from('profiles')
      .select('id, email')
      .in('id', userIds);
    if (profileError) throw new Error(`resetInviteeState: read profiles: ${profileError.message}`);
    for (const profile of profiles ?? []) emailById.set(profile.id, profile.email);
  }

  const members: Member[] = (membershipRows ?? []).map((row) => ({
    id: row.user_id,
    email: emailById.get(row.user_id) ?? '',
    joinedAt: row.joined_at,
  }));

  for (const member of members.filter((entry) => matches(entry.email) && isOld(entry.joinedAt))) {
    const removed = await request.delete(
      `/api/v1/organization/members?userId=${encodeURIComponent(member.id)}`,
    );
    expect([200, 404], `DELETE member ${member.email}`).toContain(removed.status());
  }
}
