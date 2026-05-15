import { flashcardService } from '@/server/services';
import {
  CreateFlashcardSchema,
  BulkCreateFlashcardsSchema,
  UpdateFlashcardSchema,
} from '@/server/models';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class FlashcardController {
  async create(body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = CreateFlashcardSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const flashcard = await flashcardService.create(parsed.data, userId);

      return { success: true, statusCode: 201, data: flashcard };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async list(
    userId: string,
    filters?: { topicIds?: string[]; spaceIds?: string[] },
  ): Promise<ControllerResponse> {
    try {
      const flashcards = await flashcardService.list(userId, filters);

      return { success: true, statusCode: 200, data: flashcards };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async bulkCreate(body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = BulkCreateFlashcardsSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const flashcards = await flashcardService.bulkCreate(parsed.data, userId);

      return { success: true, statusCode: 201, data: flashcards };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getById(id: string, userId: string): Promise<ControllerResponse> {
    try {
      const flashcard = await flashcardService.getById(id, userId);

      return { success: true, statusCode: 200, data: flashcard };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async update(id: string, body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = UpdateFlashcardSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const flashcard = await flashcardService.update(id, parsed.data, userId);

      return { success: true, statusCode: 200, data: flashcard };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async delete(id: string, userId: string): Promise<ControllerResponse> {
    try {
      await flashcardService.delete(id, userId);

      return { success: true, statusCode: 200, data: { success: true } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const flashcardController = new FlashcardController();
