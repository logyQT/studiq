import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import type { ErrorLogService } from '@/server/services/error-log.service';

export class ErrorLogController {
  constructor(private errorLogService: ErrorLogService) {}

  async list(searchParams: URLSearchParams): Promise<ControllerResponse> {
    const search = searchParams.get('search') ?? undefined;
    const errorCode = searchParams.get('errorCode') ?? undefined;
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const result = await this.errorLogService.list({ search, errorCode, limit, offset });
    return controllerResponse.success(result);
  }

  async getById(id: string): Promise<ControllerResponse> {
    const entry = await this.errorLogService.getById(id);
    if (!entry) return controllerResponse.error('NOT_FOUND');
    return controllerResponse.success(entry);
  }
}
