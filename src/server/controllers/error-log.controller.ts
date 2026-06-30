import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import { errorLogService } from '@/server/services';

export class ErrorLogController {
  async list(searchParams: URLSearchParams): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const search = searchParams.get('search') ?? undefined;
      const errorCode = searchParams.get('errorCode') ?? undefined;
      const limit = parseInt(searchParams.get('limit') ?? '50', 10);
      const offset = parseInt(searchParams.get('offset') ?? '0', 10);

      const result = await errorLogService.list({ search, errorCode, limit, offset });
      return controllerResponse.success(result);
    });
  }

  async getById(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const entry = await errorLogService.getById(id);
      if (!entry) return controllerResponse.error('NOT_FOUND');
      return controllerResponse.success(entry);
    });
  }
}

export const errorLogController = new ErrorLogController();
