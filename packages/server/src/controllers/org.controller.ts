import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { z } from '@studiq/server/lib/zod';
import { type OrgService, orgService } from '@studiq/server/services/org.service';

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
export const orgController = wrapService(new OrgController(orgService), 'org.controller');
