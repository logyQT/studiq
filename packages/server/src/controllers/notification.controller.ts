import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  NotificationIdParamsSchema,
  NotificationListQuerySchema,
} from '@studiq/server/models/notification.model';
import {
  type NotificationService,
  notificationService,
} from '@studiq/server/services/notification.service';

export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  async list(query: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = NotificationListQuerySchema.safeParse(query ?? {});
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.notificationService.list(ctx, parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async markRead(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = NotificationIdParamsSchema.safeParse({ id });
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.notificationService.markRead(ctx, parsed.data.id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async markAllRead(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.notificationService.markAllRead(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}

export const notificationController = wrapService(
  new NotificationController(notificationService),
  'notification.controller',
);
