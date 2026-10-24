import { AccountType } from '@studiq/authz';
import { organizationController } from '@studiq/server/controllers/organization.controller';
import { requireFeature } from '@studiq/server/lib/features';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { storageService } from '@studiq/server/services/storage.service';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      // with-auth.ts only sets ctx.activeOrgId (and ctx.orgRoleId) when a
      // real org_members row exists for this exact org+user, so a forged
      // active_org_id cookie cannot reach here. Both checks are kept as
      // defence in depth.
      if (id !== ctx.activeOrgId || !ctx.orgRoleId) {
        return NextResponse.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });
      }

      // This route is branding-only, so the feature gates the whole handler.
      // Deliberately BEFORE the try block and the upload: without this a
      // featureless org would still pay for a storage write, and the throw
      // would otherwise be swallowed by the catch below into a 500 instead
      // of surfacing as the 403 it should be.
      await requireFeature(ctx, 'branding');

      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ success: false, error: 'MISSING_FIELDS' }, { status: 422 });
      }

      try {
        const { url } = await storageService.uploadToBucket(ctx.userId, file, 'org-logos', id);
        return toNextResponse(await organizationController.update(ctx, id, { logoUrl: url }));
      } catch {
        return NextResponse.json({ success: false, error: 'INTERNAL_SERVER' }, { status: 500 });
      }
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}
