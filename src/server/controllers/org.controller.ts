import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import { ValidationErrorCode } from '@/lib/validation-errors';
import { z } from '@/lib/zod';
import type { OrgService } from '@/server/services/org.service';

const SwitchOrgSchema = z.object({
  orgId: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
});

export class OrgController {
  constructor(private orgService: OrgService) {}

  async listOrgs(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.orgService.listOrgs(ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async switchOrg(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = SwitchOrgSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.orgService.verifyMembership(ctx.userId, parsed.data.orgId);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ orgId: parsed.data.orgId });
  }
}
