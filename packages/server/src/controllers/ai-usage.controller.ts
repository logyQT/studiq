import type { RequestContext } from '@studiq/authz';
import {
  controllerResponse,
  type ControllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import {
  AI_TOKENS_LIMIT_KEY,
  limitsResolver,
  type UsageInfo,
} from '@studiq/server/services/limits.resolver';

/**
 * Read-only view of the caller's AI token budget (#379). The chat route already
 * enforces `max_ai_tokens_per_day`; this exposes the same number so the UI can
 * render the daily counter. No input to validate → no model file.
 */
export class AiUsageController {
  async myUsage(ctx: RequestContext): Promise<ControllerResponse<UsageInfo>> {
    const usage = await limitsResolver.getUsage(ctx, AI_TOKENS_LIMIT_KEY);
    return controllerResponse.success(usage);
  }
}
export const aiUsageController = wrapService(new AiUsageController(), 'ai-usage.controller');
