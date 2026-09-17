import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { SearchQuerySchema } from '@studiq/server/models/search.model';
import { type SearchService, searchService } from '@studiq/server/services/search.service';

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
