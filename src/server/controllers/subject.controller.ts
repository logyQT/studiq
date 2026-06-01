import { subjectService } from '@/server/services';
import { CreateSubjectSchema, UpdateSubjectSchema } from '@/server/models';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';
import { Nullable } from '@/types';

export class SubjectController {
  async create(body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = CreateSubjectSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const subject = await subjectService.create(parsed.data, userId);

      return { success: true, statusCode: 201, data: subject };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async list(userId: string, universityId: Nullable<string>): Promise<ControllerResponse> {
    try {
      const subjects = await subjectService.list(userId, universityId);

      return { success: true, statusCode: 200, data: subjects };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getById(id: string, userId: string): Promise<ControllerResponse> {
    try {
      const subject = await subjectService.getById(id, userId);

      return { success: true, statusCode: 200, data: subject };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async update(id: string, body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = UpdateSubjectSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const subject = await subjectService.update(id, parsed.data, userId);

      return { success: true, statusCode: 200, data: subject };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async delete(id: string, userId: string): Promise<ControllerResponse> {
    try {
      await subjectService.delete(id, userId);

      return { success: true, statusCode: 200, data: { success: true } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const subjectController = new SubjectController();
