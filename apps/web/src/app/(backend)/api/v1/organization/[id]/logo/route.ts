import { AccountType } from '@studiq/authz';
import { organizationController } from '@studiq/server/controllers/organization.controller';
import { requireFeature } from '@studiq/server/lib/features';
import { handleApiError, toNextResponse } from '@studiq/server/lib/http-utils';
import { error as logError } from '@studiq/server/lib/log';
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

      let formData: FormData;
      try {
        formData = await req.formData();
      } catch (error) {
        // Malformed or truncated multipart body — a client error, not a 500 (#185).
        return handleApiError(error, 'BAD_REQUEST');
      }

      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ success: false, error: 'MISSING_FIELDS' }, { status: 422 });
      }

      try {
        // Read the current row *before* writing anything: without its logo_url
        // the object we are about to replace becomes unreachable while staying
        // public (#281). If this read fails we fail closed and upload nothing,
        // so we can never create an orphan we know we cannot clean up.
        const current = await organizationController.getById(id);
        if (!current.success) return toNextResponse(current);

        const previous = (current.data as { logo_url?: unknown } | undefined)?.logo_url;
        const previousLogoUrl =
          typeof previous === 'string' && previous.length > 0 ? previous : null;

        const { url } = await storageService.uploadToBucket(ctx.userId, file, 'org-logos', id);
        const result = await organizationController.update(ctx, id, { logoUrl: url });

        // Only after the row points at the new object is the old one an orphan.
        // Best-effort: delete never throws, and the route must not turn a
        // successful logo change into a 500 that makes the manager re-upload.
        if (result.success && previousLogoUrl && previousLogoUrl !== url) {
          try {
            await storageService.deleteObjectByPublicUrl('org-logos', previousLogoUrl, id);
          } catch (error) {
            logError('Previous logo cleanup failed', { orgId: id, error });
          }
        }

        return toNextResponse(result);
      } catch (error) {
        // Surface validation failures (422) and oversize uploads (413) instead
        // of collapsing every one of them into a 500.
        return handleApiError(error);
      }
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}
