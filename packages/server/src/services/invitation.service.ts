import { AccountType, type RequestContext } from '@studiq/authz';
import { normalizeInviteToken } from '@studiq/server/lib/invite-token';
import { error as logError, log, warn } from '@studiq/server/lib/log';
import { getMailer } from '@studiq/server/lib/mailer';
import type { Mailer, MailLocale } from '@studiq/server/lib/mailer/mailer';
import { wrapService } from '@studiq/server/lib/observability';
import { createRateLimiter } from '@studiq/server/lib/rate-limiter';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import type { CreateInviteInput } from '@studiq/server/models/invitation.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodIssue } from 'zod';
import {
  type Notifier,
  noopNotifier,
  notificationService,
} from '@studiq/server/services/notification.service';

/** The one place the copyable registration link is built, so link and code cannot drift. */
function buildInviteLink(baseUrl: string, token: string): string {
  return `${baseUrl}/join?token=${token}`;
}

/**
 * Invitation e-mails per organization per hour (#604). Past the limit the
 * invitation is still created and its link returned; only the message is skipped.
 * In-memory, like every limiter here, so it is per server process.
 */
export const INVITE_MAIL_LIMIT_PER_HOUR = 200;
const inviteMailLimiter = createRateLimiter(60 * 60 * 1000, INVITE_MAIL_LIMIT_PER_HOUR);

interface InviteMailJob {
  invitationId: string;
  email: string;
  token: string;
  locale?: MailLocale;
}

/** Only a code or a class name is logged: provider messages can quote the address. */
function mailErrorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return 'UNKNOWN';
}

/** Internal invitation shape used by preview + accept. Never sent to a caller. */
interface LoadedInvite {
  email: string;
  /** Null for legacy rows; such an invite can never be accepted into authority. */
  inviterId: string | null;
  isAccepted: boolean;
  expiresAt: string;
  organizationId: string | null;
  targetOrgRoleId: string;
  organizationName: string;
  orgRoleName: string;
  /** Organization the target role belongs to — must match `organizationId`. */
  roleOrganizationId: string | null;
}

export class InvitationService {
  constructor(
    private createClient: () => Promise<SupabaseClient>,
    private createAdminClient: () => SupabaseClient = createServiceClient,
    /** Null when no mail adapter is configured: the copyable link is then the only delivery path. */
    private getMailer: () => Mailer | null = () => null,
    /** Tells the inviter that the invitation was accepted; none in unit tests. */
    private notifier: Notifier = noopNotifier,
  ) {}

  /**
   * Best-effort e-mail delivery of freshly created invitations (#604). It never
   * throws and never touches the rows or the links the caller already holds, so a
   * missing mailer, a bad config, the rate limit or a provider outage all degrade
   * to the #313 copy-link fallback. One audit log line per message, no address.
   *
   * Idempotency: this runs once, right after the INSERT, and nothing retries it,
   * so a row is mailed at most once.
   */
  private async sendInvitationMails(
    ctx: RequestContext,
    organizationId: string,
    baseUrl: string,
    expiresAt: Date,
    jobs: InviteMailJob[],
  ): Promise<void> {
    try {
      const mailer = this.getMailer();
      if (!mailer || jobs.length === 0) return;

      const allowed = jobs.filter(() => inviteMailLimiter.check(organizationId).allowed);
      if (allowed.length < jobs.length) {
        warn('invitation.mail_rate_limited', {
          traceId: ctx.traceId,
          organizationId,
          skipped: jobs.length - allowed.length,
        });
      }
      if (allowed.length === 0) return;

      const admin = this.createAdminClient();
      const [org, inviter] = await Promise.all([
        admin.from('organizations').select('name').eq('id', organizationId).maybeSingle(),
        admin.from('profiles').select('full_name').eq('id', ctx.userId).maybeSingle(),
      ]);
      const orgName = (org.data?.name as string | undefined) ?? 'StudiQ';
      const inviterName = (inviter.data?.full_name as string | null | undefined) ?? null;

      const outcomes = await Promise.allSettled(
        allowed.map((job) =>
          mailer.sendInvitation({
            to: job.email,
            orgName,
            inviterName,
            joinUrl: buildInviteLink(baseUrl, job.token),
            expiresAt,
            locale: job.locale ?? 'pl',
          }),
        ),
      );

      outcomes.forEach((outcome, index) => {
        const attributes = {
          traceId: ctx.traceId,
          organizationId,
          invitationId: allowed[index].invitationId,
        };
        if (outcome.status === 'fulfilled') log('invitation.mail_sent', attributes);
        else
          logError('invitation.mail_failed', {
            ...attributes,
            errorCode: mailErrorCode(outcome.reason),
          });
      });
    } catch (err) {
      logError('invitation.mail_failed', {
        traceId: ctx.traceId,
        organizationId,
        errorCode: mailErrorCode(err),
      });
    }
  }

  /**
   * Read an invitation on the service-role client. Public preview and accept both
   * run before the caller is a member, so the invitation, its organization and
   * its role are invisible under RLS. The 32-hex token is the capability.
   */
  private async loadInvite(token: string): Promise<LoadedInvite | null> {
    const supabase = this.createAdminClient();

    const { data, error } = await supabase
      .from('invitations')
      .select(
        'email, inviter_id, is_accepted, expires_at, organization_id, target_org_role_id, organizations!inner(name), org_roles!inner(name, organization_id)',
      )
      .eq('token', token)
      .single();

    if (error || !data) return null;

    const org = data.organizations as unknown as { name: string } | null;
    const role = data.org_roles as unknown as { name: string; organization_id: string } | null;

    return {
      email: data.email,
      inviterId: data.inviter_id ?? null,
      isAccepted: data.is_accepted === true,
      expiresAt: data.expires_at,
      organizationId: data.organization_id ?? null,
      targetOrgRoleId: data.target_org_role_id,
      organizationName: org?.name ?? '',
      orgRoleName: role?.name ?? '',
      roleOrganizationId: role?.organization_id ?? null,
    };
  }

  /**
   * Common validity gate for preview and accept. An invitation is gone once it
   * is expired, already used, or points at a role that is not part of its own
   * organization (a cross-tenant reference would leak that org's permission
   * scopes through the member row).
   */
  private isInviteUsable(invite: LoadedInvite): boolean {
    return (
      !invite.isAccepted &&
      new Date(invite.expiresAt) >= new Date() &&
      invite.organizationId !== null &&
      invite.roleOrganizationId === invite.organizationId
    );
  }

  /**
   * Resolve the organization an invitation is written to and prove the caller
   * may act in it.
   *
   * `organizationId` may name any org the caller belongs to (API contract),
   * never a foreign one. `ctx.activeOrgId` is a client-controlled cookie, so
   * membership is always verified against `org_members` — a cookie pointing at
   * a foreign org must not become a write target (#242).
   *
   * Note for future work: `ctx.permissionScopes` is resolved for `activeOrgId`
   * only. If an invite permission is ever added, scopes must be resolved for
   * the resolved target org (or `organizationId` must be restricted to
   * `activeOrgId`).
   */
  private async resolveTargetOrganization(
    supabase: SupabaseClient,
    ctx: RequestContext,
    requestedOrganizationId?: string,
  ): Promise<ServiceResult<string>> {
    if (ctx.accountType !== AccountType.MANAGER && ctx.accountType !== AccountType.EDUCATOR) {
      return failure('FORBIDDEN');
    }

    const organizationId = requestedOrganizationId ?? ctx.activeOrgId ?? undefined;
    if (!organizationId) return failure('FORBIDDEN');

    const { data: membership, error } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('organization_id', organizationId)
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!membership) return failure('FORBIDDEN');

    return success(organizationId);
  }

  /** An invite may only grant a role that belongs to the target organization. */
  private async assertRoleBelongsToOrganization(
    supabase: SupabaseClient,
    organizationId: string,
    orgRoleId: string,
  ): Promise<ServiceResult<void>> {
    const { data, error } = await supabase
      .from('org_roles')
      .select('id')
      .eq('id', orgRoleId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return failure('FORBIDDEN');
    return success(undefined);
  }

  /**
   * Single source of truth for "may `userId` grant `orgRoleId`?" — the same
   * function the invitations INSERT policy calls. Runs on the service-role
   * client with an explicit actor, so it also works under the integration
   * harness (whose user client is a service client) and cannot be spoofed:
   * `p_actor` is always `ctx.userId` from the verified JWT.
   */
  private async canAssignRole(userId: string, orgRoleId: string): Promise<ServiceResult<boolean>> {
    const { data, error } = await this.createAdminClient().rpc('can_assign_org_role', {
      p_actor: userId,
      p_role_id: orgRoleId,
    });

    if (error) return toDbFailure(error);
    return success(data === true);
  }

  /**
   * App-layer mirror of the invitations INSERT policy: rejects before any write.
   * All-or-nothing, so one un-grantable role rejects the whole batch and nothing
   * is inserted (same contract as the 422 role check above it).
   */
  private async assertCanAssignRoles(
    ctx: RequestContext,
    orgRoleIds: string[],
  ): Promise<ServiceResult<void>> {
    for (const orgRoleId of new Set(orgRoleIds)) {
      const authority = await this.canAssignRole(ctx.userId, orgRoleId);
      if (!authority.success) return authority;
      if (authority.data !== true) return failure('FORBIDDEN');
    }
    return success(undefined);
  }

  /**
   * The inviter must still be allowed to grant the target role. Re-checked at
   * preview and accept: an invitation minted by a manager who was later demoted
   * (or by a member who should never have had the capability) is dead.
   */
  private async isInviteAuthorized(invite: LoadedInvite): Promise<boolean> {
    if (!invite.inviterId) return false;

    const authority = await this.canAssignRole(invite.inviterId, invite.targetOrgRoleId);
    // An RPC error means the invitation cannot be proven valid, as before.
    return authority.success && authority.data === true;
  }

  async createInvitation(
    ctx: RequestContext,
    data: CreateInviteInput,
  ): Promise<
    ServiceResult<{
      success: boolean;
      invitationId: string;
      inviteLink: string;
      inviteCode: string;
    }>
  > {
    const supabase = await this.createClient();

    // The body may only *select* one of the caller's memberships, never extend
    // the tenant: a foreign `organizationId` (or a forged `active_org_id`
    // cookie) is rejected before any write (#242).
    const targetOrg = await this.resolveTargetOrganization(supabase, ctx, data.organizationId);
    if (!targetOrg.success) return targetOrg;

    const roleCheck = await this.assertRoleBelongsToOrganization(
      supabase,
      targetOrg.data,
      data.targetOrgRoleId,
    );
    if (!roleCheck.success) return roleCheck;

    // May this caller grant that role at all? The INSERT policy asks the same
    // question, but RLS is bypassed by the service-role client (integration
    // harness, admin flows), so the endpoint must not rely on it (#189).
    const authority = await this.assertCanAssignRoles(ctx, [data.targetOrgRoleId]);
    if (!authority.success) return authority;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // The link is the only delivery path for an invitation (#313, e-mail is
    // #604), so a missing public origin must fail before the row is written —
    // same position the bulk path uses. Otherwise the manager is left with an
    // "Oczekujące" row that can never be handed to the invitee.
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!baseUrl) return failure('INTERNAL_SERVER');

    const { data: invitation, error: insertError } = await supabase
      .from('invitations')
      .insert({
        email: data.email,
        target_org_role_id: data.targetOrgRoleId,
        organization_id: targetOrg.data,
        inviter_id: ctx.userId,
        expires_at: expiresAt.toISOString(),
      })
      .select('id, token')
      .single();

    if (insertError) return toDbFailure(insertError);

    // E-mail is best effort on top of the link (#604): the message carries this
    // same link, and a failed send never affects the row or the response (#313).
    await this.sendInvitationMails(ctx, targetOrg.data, baseUrl, expiresAt, [
      {
        invitationId: invitation.id,
        email: data.email,
        token: invitation.token,
        locale: data.locale,
      },
    ]);

    return success({
      success: true,
      invitationId: invitation.id,
      inviteLink: buildInviteLink(baseUrl, invitation.token),
      // The creator already holds the token inside `inviteLink`; returning it
      // separately lets the UI show/copy the bare code without widening the
      // sensitive list endpoint.
      inviteCode: invitation.token,
    });
  }

  /**
   * Bulk invite is all-or-nothing: every entry is checked before anything is
   * written, and the rows land in a single multi-row INSERT (atomic in
   * PostgreSQL), so a rejected entry can never leave a half-sent batch behind
   * (MGR-INV-02).
   *
   * A batch is single-tenant by contract: the organization is resolved once and
   * every entry with an explicit `organizationId` must name that same org.
   */
  async createInvitationsBulk(
    ctx: RequestContext,
    invitations: CreateInviteInput[],
  ): Promise<
    ServiceResult<
      Array<{
        email: string;
        success: true;
        data: { success: true; invitationId: string; inviteLink: string; inviteCode: string };
      }>
    >
  > {
    if (invitations.length === 0) return failure('BAD_REQUEST');

    const supabase = await this.createClient();

    // Same membership gate as the single create: the body may only select one
    // of the caller's orgs, never extend the tenant (#242).
    const targetOrg = await this.resolveTargetOrganization(
      supabase,
      ctx,
      invitations[0].organizationId,
    );
    if (!targetOrg.success) return targetOrg;

    const organizationId = targetOrg.data;

    const foreignOrgIssues: ZodIssue[] = [];
    invitations.forEach((invite, index) => {
      if (invite.organizationId && invite.organizationId !== organizationId) {
        foreignOrgIssues.push({
          code: 'custom',
          message: ValidationErrorCode.INVALID_INPUT,
          path: ['invitations', index, 'organizationId'],
        });
      }
    });
    if (foreignOrgIssues.length > 0) return failure('UNPROCESSABLE_ENTITY', foreignOrgIssues);

    // Checked before any write: an invite that was inserted before this check
    // could not have produced a usable link anyway, so it would be an orphan.
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!baseUrl) return failure('INTERNAL_SERVER');

    const roleIds = [...new Set(invitations.map((invite) => invite.targetOrgRoleId))];
    const { data: orgRoles, error: roleError } = await supabase
      .from('org_roles')
      .select('id')
      .eq('organization_id', organizationId)
      .in('id', roleIds);

    if (roleError) return toDbFailure(roleError);

    const foundRoleIds = new Set((orgRoles ?? []).map((role) => role.id as string));
    const roleIssues: ZodIssue[] = [];
    invitations.forEach((invite, index) => {
      if (!foundRoleIds.has(invite.targetOrgRoleId)) {
        roleIssues.push({
          code: 'custom',
          message: ValidationErrorCode.INVALID_ROLE,
          path: ['invitations', index, 'targetOrgRoleId'],
        });
      }
    });
    if (roleIssues.length > 0) return failure('UNPROCESSABLE_ENTITY', roleIssues);

    // Grant authority for every distinct target role, before any write. RLS
    // enforces the same predicate on INSERT, but the endpoint must not depend on
    // RLS being in the path (#189).
    const authority = await this.assertCanAssignRoles(ctx, roleIds);
    if (!authority.success) return authority;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // One statement = one transaction: per-row RLS still applies, so a denied
    // role fails the whole insert and leaves zero rows behind.
    const { data: created, error: insertError } = await supabase
      .from('invitations')
      .insert(
        invitations.map((invite) => ({
          email: invite.email,
          target_org_role_id: invite.targetOrgRoleId,
          organization_id: organizationId,
          inviter_id: ctx.userId,
          expires_at: expiresAt.toISOString(),
        })),
      )
      .select('id, token, email');

    if (insertError) return toDbFailure(insertError);
    if (created?.length !== invitations.length) return failure('INTERNAL_SERVER');

    // `INSERT ... SELECT` does not promise result order, so map by e-mail back
    // to the input order the page renders. Duplicate addresses are
    // interchangeable (each still gets its own row and token).
    const createdByEmail = new Map<string, Array<{ id: string; token: string }>>();
    for (const row of created) {
      const key = row.email as string;
      const bucket = createdByEmail.get(key) ?? [];
      bucket.push({ id: row.id, token: row.token });
      createdByEmail.set(key, bucket);
    }

    // Each result carries the submitted address: it is the only identifier the
    // manager sees in „Wyniki”, and the invite table is sorted newest-first, so
    // position alone cannot attribute a status (MGR-INV-02).
    const results: Array<{
      email: string;
      success: true;
      data: { success: true; invitationId: string; inviteLink: string; inviteCode: string };
    }> = [];

    const mailJobs: InviteMailJob[] = [];
    for (const invite of invitations) {
      const row = createdByEmail.get(invite.email)?.shift();
      if (!row) return failure('INTERNAL_SERVER');

      mailJobs.push({
        invitationId: row.id,
        email: invite.email,
        token: row.token,
        locale: invite.locale,
      });

      results.push({
        email: invite.email,
        success: true,
        data: {
          success: true,
          invitationId: row.id,
          // Always returned, in every environment: the copy button stays the
          // fallback when no e-mail is sent or delivery fails (#313, #604).
          inviteLink: buildInviteLink(baseUrl, row.token),
          // Same value as the token inside `inviteLink`, exposed so the manager
          // can also copy the bare code the join field accepts.
          inviteCode: row.token,
        },
      });
    }

    // One message per created row, after every row has its link; a send failure
    // cannot fail the batch (#604).
    await this.sendInvitationMails(ctx, organizationId, baseUrl, expiresAt, mailJobs);

    return success(results);
  }

  async getInvitationByToken(token: string): Promise<
    ServiceResult<
      {
        email: string;
        organizationId: string;
        organizationName: string;
        targetRole: string;
        orgRoleName: string;
      },
      'NOT_FOUND' | 'GONE'
    >
  > {
    // The join screens ask for a „kod”, but „Kopiuj link” copies a URL. Accept
    // either: both surfaces converge here, and a link is never sent to the DB.
    const inviteToken = normalizeInviteToken(token);
    if (!inviteToken) return failure('NOT_FOUND');

    const invite = await this.loadInvite(inviteToken);
    if (!invite) return failure('NOT_FOUND');
    if (!this.isInviteUsable(invite)) return failure('GONE');
    if (!(await this.isInviteAuthorized(invite))) return failure('GONE');

    // `inviterId` deliberately stays server-side: the public preview only needs
    // the org/role names.
    return success({
      email: invite.email,
      organizationId: invite.organizationId as string,
      organizationName: invite.organizationName,
      targetRole: invite.targetOrgRoleId,
      orgRoleName: invite.orgRoleName,
    });
  }

  async acceptInvitation(
    ctx: RequestContext,
    token: string,
  ): Promise<ServiceResult<{ id: string; name: string; orgRoleId: string }>> {
    return this.acceptInvitationForUser(ctx.userId, token);
  }

  /**
   * Same accept flow, addressed by user id instead of a `RequestContext`. Used by
   * the activation callback, where the user is proven by the OTP but there is no
   * `withAuth()` context yet (#311). Every authorization check below still runs:
   * this is not a privileged shortcut.
   */
  async acceptInvitationForUser(
    userId: string,
    token: string,
  ): Promise<ServiceResult<{ id: string; name: string; orgRoleId: string }>> {
    // The accepting user is not a member yet, and org_members has no INSERT
    // policy, so the whole accept flow runs on the service-role client. That
    // bypasses RLS, so this method is the authorization choke point: the token
    // must be live, unused, internally consistent, and the INVITER must still be
    // allowed to grant the target role (#191 B1/B6). The member-count limit
    // (#182) is still enforced below, in the same order as before.
    const supabase = this.createAdminClient();

    // Preview and claim must normalise identically, or a pasted link would
    // preview and then match zero rows on the single-use claim.
    const inviteToken = normalizeInviteToken(token);
    if (!inviteToken) return failure('NOT_FOUND');

    const invite = await this.loadInvite(inviteToken);
    if (!invite) return failure('NOT_FOUND');
    if (!this.isInviteUsable(invite)) return failure('GONE');

    // A demoted inviter (or one who never had `member.manage`) cannot promote
    // the acceptor. service_role may call the internal helper directly; any
    // error is treated as an invalid invitation rather than a 500 so a forged
    // token cannot probe the inviter's role.
    if (!(await this.isInviteAuthorized(invite))) return failure('GONE');

    // Narrowed by isInviteUsable(); re-checked for TypeScript.
    const organizationId = invite.organizationId;
    if (!organizationId) return failure('GONE');

    // The accepting user is not a member yet, and org_members has RLS, so a
    // user-scoped count would always see 0 rows and never hit the limit. The
    // caller is excluded: re-accepting an invitation (or a manager re-inviting
    // an existing member) updates that member's own row via the upsert below
    // and must not consume a second seat.
    const { count: otherMemberCount, error: countError } = await supabase
      .from('org_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .neq('user_id', userId);
    if (countError) return toDbFailure(countError);
    await limitsResolver.checkOrgLimit(
      organizationId,
      'max_students',
      otherMemberCount ?? 0,
      1,
      supabase,
    );

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', organizationId)
      .single();

    if (orgError || !org) return failure('GONE');

    // Single-use claim: consume the token BEFORE any membership write, so two
    // concurrent accepts cannot both pass the read check above. `IS NOT TRUE`
    // (not `= false`) is null-safe: a legacy NULL row is claimable, and once
    // claimed it no longer matches. Losing the claim means the token was already
    // used (or used by the concurrent request) -> 410, exactly like expiry.
    // Ordering matters: the seat limit above can still reject the accept without
    // burning the token.
    const { data: claimed, error: claimError } = await supabase
      .from('invitations')
      .update({ is_accepted: true })
      .eq('token', inviteToken)
      .not('is_accepted', 'is', true)
      .select('id')
      .maybeSingle();

    if (claimError) return toDbFailure(claimError);
    if (!claimed) return failure('GONE');

    // Explicit composite conflict target: supabase-js defaults to the primary
    // key (`id`), which never conflicts here, so the "upsert" degraded to a
    // plain INSERT and a re-accept died on org_members_organization_id_user_id_key.
    const { error: memberError } = await supabase
      .from('org_members')
      .upsert(
        {
          organization_id: organizationId,
          user_id: userId,
          org_role_id: invite.targetOrgRoleId,
        },
        { onConflict: 'organization_id,user_id' },
      )
      .select()
      .single();

    if (memberError) return toDbFailure(memberError);

    const { data: defaultGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_default', true)
      .single();

    if (defaultGroup) {
      // Re-accepts must not hit UNIQUE(group_id, user_id), and must not
      // downgrade a member who already has a different group role.
      const { error: me } = await supabase.from('group_members').upsert(
        {
          group_id: defaultGroup.id,
          user_id: userId,
          role: 'member',
        },
        { onConflict: 'group_id,user_id', ignoreDuplicates: true },
      );
      if (me) return toDbFailure(me);
    }

    if (invite.inviterId) {
      await this.notifier.invitationAccepted({
        inviterId: invite.inviterId,
        memberId: userId,
        organizationId,
      });
    }

    return success({ id: org.id, name: org.name, orgRoleId: invite.targetOrgRoleId });
  }

  async listInvitations(
    ctx: RequestContext,
    isAccepted = false,
  ): Promise<
    ServiceResult<
      Array<{
        id: string;
        email: string;
        targetOrgRoleId: string;
        orgRoleName: string;
        isAccepted: boolean;
        expiresAt: string;
        createdAt: string;
      }>
    >
  > {
    const supabase = await this.createClient();

    // Same tenant boundary as create: the cookie is client-controlled, so the
    // list scope is the caller's verified membership, not the raw cookie (#242).
    const targetOrg = await this.resolveTargetOrganization(supabase, ctx);
    if (!targetOrg.success) return targetOrg;

    let query = supabase
      .from('invitations')
      .select('*, org_roles!inner(name)')
      .eq('organization_id', targetOrg.data)
      .order('created_at', { ascending: false });

    if (!isAccepted) query = query.eq('is_accepted', false);

    const { data, error } = await query;
    if (error) return toDbFailure(error);

    return success(
      (data ?? []).map((inv) => {
        const role = inv.org_roles as unknown as { name: string } | null;
        return {
          id: inv.id,
          email: inv.email,
          targetOrgRoleId: inv.target_org_role_id,
          orgRoleName: role?.name ?? '',
          isAccepted: inv.is_accepted,
          expiresAt: inv.expires_at,
          createdAt: inv.created_at,
        };
      }),
    );
  }

  async updateInvitation(
    ctx: RequestContext,
    id: string,
    data: { targetOrgRoleId?: string },
  ): Promise<ServiceResult<void>> {
    // withAuth only sets activeOrgId (and orgRoleId) when a real org_members row
    // exists for that exact org+user, so the pair is the membership proof. Without
    // it a forged cookie would let any manager retarget another tenant's pending
    // invitation (MGR-INV-03).
    if (!ctx.activeOrgId || !ctx.orgRoleId) return failure('FORBIDDEN');

    const supabase = await this.createClient();

    const { data: invite, error: fetchError } = await supabase
      .from('invitations')
      .select('id, is_accepted')
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .maybeSingle();

    if (fetchError) return toDbFailure(fetchError);
    if (!invite) return failure('NOT_FOUND');
    if (invite.is_accepted) return failure('FORBIDDEN');

    const updateData: Record<string, string> = {};

    if (data.targetOrgRoleId) {
      // A role from another organization would let the acceptor inherit that
      // tenant's permission scopes — reject it before the update.
      const { data: role, error: roleError } = await supabase
        .from('org_roles')
        .select('id')
        .eq('id', data.targetOrgRoleId)
        .eq('organization_id', ctx.activeOrgId)
        .maybeSingle();

      if (roleError) return toDbFailure(roleError);
      if (!role) return failure('UNPROCESSABLE_ENTITY');

      updateData.target_org_role_id = data.targetOrgRoleId;
    }

    if (Object.keys(updateData).length === 0) return success(undefined);

    const { error } = await supabase
      .from('invitations')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId);
    if (error) return toDbFailure(error);

    return success(undefined);
  }

  async deleteInvitation(ctx: RequestContext, id: string): Promise<ServiceResult<void>> {
    // See updateInvitation: the cookie alone proves nothing, orgRoleId does.
    if (!ctx.activeOrgId || !ctx.orgRoleId) return failure('FORBIDDEN');

    const supabase = await this.createClient();

    const { data: invite, error: fetchError } = await supabase
      .from('invitations')
      .select('id, is_accepted')
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .maybeSingle();

    if (fetchError) return toDbFailure(fetchError);
    // A foreign or unknown id is indistinguishable to the caller (no existence
    // oracle), and the row is never touched.
    if (!invite) return failure('NOT_FOUND');
    if (invite.is_accepted) return failure('FORBIDDEN');

    const { error } = await supabase
      .from('invitations')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId);
    if (error) return toDbFailure(error);

    return success(undefined);
  }
}
export const invitationService = wrapService(
  new InvitationService(createClient, createServiceClient, getMailer, notificationService),
  'invitation.service',
);
