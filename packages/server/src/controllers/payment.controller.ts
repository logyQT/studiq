import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { type PaymentService, paymentService } from '@studiq/server/services/payment.service';

export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  async listMine(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.paymentService.listMine(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}
export const paymentController = wrapService(
  new PaymentController(paymentService),
  'payment.controller',
);
