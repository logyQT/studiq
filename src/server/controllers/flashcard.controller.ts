import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import { hasPermission, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import {
  BatchCopySchema,
  BatchDeleteSchema,
  BatchLinkSchema,
  BatchMoveSchema,
  BatchTopicsSchema,
  BatchUnlinkSchema,
  BulkCreateFlashcardsSchema,
  CopyFlashcardSchema,
  CreateFlashcardSchema,
  LinkFlashcardSchema,
  UnlinkFlashcardSchema,
  UpdateFlashcardSchema,
} from '@/server/models';
import type { FlashcardService } from '@/server/services/flashcard.service';

export class FlashcardController {
  constructor(private flashcardService: FlashcardService) {}

  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    if (!(await hasPermission(ctx, Permission.FLASHCARD_CREATE))) {
      return controllerResponse.error('FORBIDDEN');
    }

    const parsed = CreateFlashcardSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.create(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.created(result.data);
  }

  async list(
    ctx: RequestContext,
    filters?: {
      topicIds?: string[];
      deckIds?: string[];
      q?: string;
      sortBy?: string;
      sortOrder?: string;
      cursor?: string;
      limit?: number;
    },
  ): Promise<ControllerResponse> {
    const result = await this.flashcardService.list(ctx, filters);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async bulkCreate(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    if (!(await hasPermission(ctx, Permission.FLASHCARD_CREATE))) {
      return controllerResponse.error('FORBIDDEN');
    }

    const parsed = BulkCreateFlashcardsSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.bulkCreate(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.created(result.data);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.flashcardService.getById(id, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = UpdateFlashcardSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.update(id, parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.flashcardService.delete(id, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }

  async link(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = LinkFlashcardSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.link(id, parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async copy(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = CopyFlashcardSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.copy(id, parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.created(result.data);
  }

  async batchDelete(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BatchDeleteSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.batchDelete(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async batchLink(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BatchLinkSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.batchLink(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async batchTopics(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BatchTopicsSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.batchTopics(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async batchMove(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BatchMoveSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.batchMove(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async unlinkFromDeck(
    id: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const parsed = UnlinkFlashcardSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.unlinkFromDeck(id, parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async batchUnlink(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BatchUnlinkSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.batchUnlinkFromDeck(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async batchCopy(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BatchCopySchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardService.batchCopy(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }
}
