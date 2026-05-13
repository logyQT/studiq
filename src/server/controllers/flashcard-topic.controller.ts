import { flashcardTopicService } from '@/server/services';
import { CreateTopicSchema, UpdateTopicSchema } from '@/server/models';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class FlashcardTopicController {
  async create(body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = CreateTopicSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const topic = await flashcardTopicService.create(parsed.data, userId);

      return { success: true, statusCode: 201, data: topic };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async list(userId: string): Promise<ControllerResponse> {
    try {
      const topics = await flashcardTopicService.list(userId);

      return { success: true, statusCode: 200, data: topics };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getById(id: string): Promise<ControllerResponse> {
    try {
      const topic = await flashcardTopicService.getById(id);

      return { success: true, statusCode: 200, data: topic };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async update(id: string, body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = UpdateTopicSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const topic = await flashcardTopicService.update(id, parsed.data, userId);

      return { success: true, statusCode: 200, data: topic };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async delete(id: string, userId: string): Promise<ControllerResponse> {
    try {
      await flashcardTopicService.delete(id, userId);

      return { success: true, statusCode: 200, data: { success: true } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const flashcardTopicController = new FlashcardTopicController();
