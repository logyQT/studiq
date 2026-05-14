import { flashcardSpaceService } from '@/server/services';
import { CreateSpaceSchema, UpdateSpaceSchema } from '@/server/models';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class FlashcardSpaceController {
  async create(body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = CreateSpaceSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const space = await flashcardSpaceService.create(parsed.data, userId);

      return { success: true, statusCode: 201, data: space };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async list(userId: string): Promise<ControllerResponse> {
    try {
      const spaces = await flashcardSpaceService.list(userId);

      return { success: true, statusCode: 200, data: spaces };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getById(id: string, userId: string): Promise<ControllerResponse> {
    try {
      const space = await flashcardSpaceService.getById(id, userId);

      return { success: true, statusCode: 200, data: space };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async update(id: string, body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = UpdateSpaceSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const space = await flashcardSpaceService.update(id, parsed.data, userId);

      return { success: true, statusCode: 200, data: space };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async delete(id: string, userId: string): Promise<ControllerResponse> {
    try {
      await flashcardSpaceService.delete(id, userId);

      return { success: true, statusCode: 200, data: { success: true } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const flashcardSpaceController = new FlashcardSpaceController();
