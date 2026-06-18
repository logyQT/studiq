import { searchService } from '@/server/services';
import { SearchQuerySchema } from '@/server/models';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class SearchController {
  async search(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = SearchQuerySchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const results = await searchService.search(parsed.data.q, ctx, parsed.data.limit);

      return { success: true, statusCode: 200, data: results };
    }, ctx);
  }
}

export const searchController = new SearchController();
