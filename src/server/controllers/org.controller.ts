import { orgService } from '@/server/services/org.service';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';
import { z } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

const SwitchOrgSchema = z.object({
  orgId: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
});

export class OrgController {
  async listOrgs(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const orgs = await orgService.listOrgs(ctx);
      return { success: true, statusCode: 200, data: orgs };
    }, ctx);
  }

  async switchOrg(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = SwitchOrgSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      await orgService.verifyMembership(ctx.userId, parsed.data.orgId);

      return { success: true, statusCode: 200, data: { orgId: parsed.data.orgId } };
    }, ctx);
  }
}

export const orgController = new OrgController();
