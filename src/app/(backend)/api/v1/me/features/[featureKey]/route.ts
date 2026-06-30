import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { hasPermission } from '@/lib/rbac';
import { withAuth } from '@/lib/with-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ featureKey: string }> },
) {
  return withAuth(req, async (ctx) => {
    const { featureKey } = await params;
    const granted = await hasPermission(ctx, featureKey);
    return toNextResponse({ success: true, statusCode: 200, data: { hasAccess: granted } });
  });
}
