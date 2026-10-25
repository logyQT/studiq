import type { AccountType, PermissionScope, RequestContext } from '@studiq/authz';
import { ACTIVE_ORG_COOKIE } from '@studiq/server/lib/active-org-cookie';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withRequestInstrumentation } from '@studiq/server/lib/request-instrumentation';
import { createClient } from '@studiq/server/lib/supabase/server';
import type { NextRequest, NextResponse } from 'next/server';

export { ERROR_CODE_HEADER, TRACE_ID_HEADER } from '@studiq/server/lib/request-instrumentation';

export interface WithAuthOptions {
  allowedAccountTypes?: AccountType[];
}

/**
 * Authenticated request wrapper.
 *
 * The per-request observability lifecycle (root span, `x-trace-id`, metrics,
 * 4xx/5xx logs, error envelope) lives in `withRequestInstrumentation` — shared
 * with the deliberately public routes via `withPublicTracing`. This function
 * only resolves the caller (`getUser`, account type, org/group/permission
 * scopes) and then runs the handler.
 */
export async function withAuth(
  req: NextRequest,
  handler: (ctx: RequestContext) => Promise<NextResponse | Response>,
  options?: WithAuthOptions,
): Promise<NextResponse | Response> {
  return withRequestInstrumentation(req, async ({ traceId, span }) => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
    }

    const accountType = user.app_metadata?.account_type as AccountType;
    const cookieOrgId = req.cookies.get(ACTIVE_ORG_COOKIE)?.value ?? null;
    // The cookie is only a *hint*. It becomes the tenant scope exclusively when
    // the caller has an `org_members` row for that exact org — membership-row
    // presence is the proof (same rule as limits.resolver), so a forged or
    // stale id from a previous session can never widen the tenant scope.
    let activeOrgId: string | null = null;
    let orgRoleId: string | null = null;
    let groupIds: string[] = [];
    const permissionScopes: Partial<Record<string, PermissionScope>> = {};

    if (cookieOrgId) {
      const [membershipResult, groupsResult] = await Promise.all([
        supabase
          .from('org_members')
          .select('org_role_id')
          .eq('organization_id', cookieOrgId)
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase.from('group_members').select('group_id').eq('user_id', user.id),
      ]);

      if (membershipResult.data) {
        activeOrgId = cookieOrgId;
        orgRoleId = membershipResult.data.org_role_id ?? null;
      }
      groupIds = (groupsResult.data ?? []).map((r) => r.group_id);

      if (orgRoleId) {
        const { data: perms } = await supabase
          .from('org_role_permissions')
          .select('permission_name, scope')
          .eq('org_role_id', orgRoleId);

        for (const row of perms ?? []) {
          permissionScopes[row.permission_name] = row.scope as PermissionScope;
        }
      }
    }

    if (options?.allowedAccountTypes && !options.allowedAccountTypes.includes(accountType)) {
      return toNextResponse({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    }

    const ctx: RequestContext = {
      traceId,
      userId: user.id,
      accountType,
      orgRoleId,
      activeOrgId,
      url: req.url,
      method: req.method,
      groupIds,
      permissionScopes,
    };

    span.setAttributes({
      'user.id': user.id,
      'user.account_type': accountType,
    });

    return handler(ctx);
  });
}
