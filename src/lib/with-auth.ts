import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import type { NextRequest, NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import { toNextResponse } from '@/lib/http-utils';
import type { PermissionScope } from '@/lib/permissions';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import type { AccountType } from '@/types';

export interface WithAuthOptions {
  allowedAccountTypes?: AccountType[];
}

export async function withAuth(
  req: NextRequest,
  handler: (ctx: RequestContext) => Promise<NextResponse>,
  options?: WithAuthOptions,
): Promise<NextResponse> {
  const tracer = trace.getTracer('api');
  const span = tracer.startSpan(`${req.method} /api/**`, {
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
    },
  });

  const t0 = performance.now();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      span.setAttribute('http.status_code', 401);
      span.setStatus({ code: SpanStatusCode.ERROR });
      return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
    }

    const traceId = crypto.randomUUID();
    const accountType = user.app_metadata?.account_type as AccountType;
    const cookieOrgId = req.cookies.get('active_org_id')?.value ?? null;
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

      orgRoleId = membershipResult.data?.org_role_id ?? null;
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
      span.setAttribute('http.status_code', 403);
      span.setStatus({ code: SpanStatusCode.ERROR });
      return toNextResponse({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    }

    const ctx: RequestContext = {
      traceId,
      userId: user.id,
      accountType,
      orgRoleId,
      activeOrgId: cookieOrgId,
      url: req.url,
      method: req.method,
      groupIds,
      permissionScopes,
    };

    span.setAttributes({
      'user.id': user.id,
      'user.account_type': accountType,
    });

    const res = await context.with(trace.setSpan(context.active(), span), () => handler(ctx));

    span.setAttribute('http.status_code', res.status);
    span.setStatus({ code: SpanStatusCode.OK });

    return res;
  } catch (error) {
    span.setAttribute('http.status_code', 500);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(error instanceof Error ? error : new Error(String(error)));

    if (error instanceof AppError) {
      return toNextResponse({
        success: false,
        statusCode: error.statusCode,
        error: error.code,
      });
    }

    if (error instanceof SyntaxError) {
      return toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
    }

    console.error('[Unhandled API Error]', error);

    return toNextResponse({
      success: false,
      statusCode: 500,
      error: 'INTERNAL_SERVER',
    });
  } finally {
    span.setAttribute('duration.ms', performance.now() - t0);
    span.end();
  }
}
