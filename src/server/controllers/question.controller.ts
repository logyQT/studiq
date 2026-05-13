import { questionService } from '@/server/services';
import { CreateQuestionSchema, UpdateQuestionSchema } from '@/server/models';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class QuestionController {
  async create(body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = CreateQuestionSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const question = await questionService.create(parsed.data, userId);

      return { success: true, statusCode: 201, data: question };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async list(filters?: {
    subjectId?: string;
    type?: string;
    difficulty?: string;
  }): Promise<ControllerResponse> {
    try {
      const questions = await questionService.list(filters);

      return { success: true, statusCode: 200, data: questions };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getById(id: string): Promise<ControllerResponse> {
    try {
      const question = await questionService.getById(id);

      return { success: true, statusCode: 200, data: question };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async update(id: string, body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = UpdateQuestionSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const question = await questionService.update(id, parsed.data, userId);

      return { success: true, statusCode: 200, data: question };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async delete(id: string, userId: string): Promise<ControllerResponse> {
    try {
      await questionService.delete(id, userId);

      return { success: true, statusCode: 200, data: { success: true } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const questionController = new QuestionController();
