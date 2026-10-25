import type { RequestContext } from '@studiq/authz';
import { AI_TOKENS_LIMIT_KEY } from '@studiq/server/config/limits.config';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import {
  type LimitsResolver,
  type UsageInfo,
  limitsResolver,
} from '@studiq/server/services/limits.resolver';

export class AiController {
  constructor(private limitsResolver: LimitsResolver) {}

  /**
   * Read-only view of the caller's daily AI token position. Backs the plan
   * badge on the AI page — the enforcement itself stays in `POST /ai/chat`.
   */
  async getUsage(ctx: RequestContext): Promise<ControllerResponse<UsageInfo>> {
    const usage = await this.limitsResolver.getUsage(ctx, AI_TOKENS_LIMIT_KEY);
    return controllerResponse.success(usage);
  }
}
export const aiController = wrapService(new AiController(limitsResolver), 'ai.controller');
