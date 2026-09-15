import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import { wrapService } from '@/lib/observability';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import { SearchQuerySchema } from '@/server/models/search.model';
import { type SearchService, searchService } from '@/server/services/search.service';

export class SearchController {
  constructor(private searchService: SearchService) {}

  async search(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = SearchQuerySchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.searchService.search(parsed.data.q, ctx, parsed.data.limit);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}
export const searchController = wrapService(
  new SearchController(searchService),
  'search.controller',
);
