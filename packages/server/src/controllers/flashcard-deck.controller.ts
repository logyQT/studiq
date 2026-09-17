import type { RequestContext } from '@studiq/authz';
import { can, Permission } from '@studiq/server/lib/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  BatchDeleteDeckSchema,
  BatchToggleSuspendSchema,
  BulkCreateDeckSchema,
  CreateDeckSchema,
  DeckListQuerySchema,
  UpdateDeckSchema,
} from '@studiq/server/models/flashcard-deck.model';
import {
  type FlashcardDeckService,
  flashcardDeckService,
} from '@studiq/server/services/flashcard-deck.service';

export class FlashcardDeckController {
  constructor(private flashcardDeckService: FlashcardDeckService) {}

  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    if (!(await can(ctx, Permission.DECK_CREATE))) {
      return controllerResponse.error('FORBIDDEN');
    }

    const parsed = CreateDeckSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardDeckService.create(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.created(result.data);
  }

  async list(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = DeckListQuerySchema.safeParse(body ?? {});

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardDeckService.list(ctx, parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.flashcardDeckService.getById(id, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = UpdateDeckSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardDeckService.update(id, parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.flashcardDeckService.delete(id, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }

  async bulkCreate(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BulkCreateDeckSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardDeckService.bulkCreate(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.created(result.data);
  }

  async batchDelete(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BatchDeleteDeckSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardDeckService.batchDelete(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async batchToggleSuspend(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BatchToggleSuspendSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardDeckService.batchToggleSuspend(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }
}
export const flashcardDeckController = wrapService(
  new FlashcardDeckController(flashcardDeckService),
  'flashcard-deck.controller',
);
