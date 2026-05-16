import { CreateUniversitySchema, UpdateUniversitySchema, UniversityIdParamsSchema } from '@/server/models';
import { universityService } from '@/server/services';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class UniversityController {
  async create(body: unknown): Promise<ControllerResponse> {
    try {
      const parsedData = CreateUniversitySchema.safeParse(body);

      if (!parsedData.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsedData.error.issues,
        };
      }

      const result = await universityService.create(parsedData.data);

      return { success: true, statusCode: 201, data: result };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getAll(): Promise<ControllerResponse> {
    try {
      const universities = await universityService.getAll();
      return { success: true, statusCode: 200, data: universities };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getById(id: string): Promise<ControllerResponse> {
    try {
      const parsedId = UniversityIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return {
          success: false,
          statusCode: 400,
          error: 'BAD_REQUEST',
        };
      }

      const university = await universityService.getById(parsedId.data.id);
      return { success: true, statusCode: 200, data: university };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async update(id: string, body: unknown): Promise<ControllerResponse> {
    try {
      const parsedId = UniversityIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return {
          success: false,
          statusCode: 400,
          error: 'BAD_REQUEST',
        };
      }

      const parsedData = UpdateUniversitySchema.safeParse(body);
      if (!parsedData.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsedData.error.issues,
        };
      }

      const result = await universityService.update(parsedId.data.id, parsedData.data);
      return { success: true, statusCode: 200, data: result };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async delete(id: string): Promise<ControllerResponse> {
    try {
      const parsedId = UniversityIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return {
          success: false,
          statusCode: 400,
          error: 'BAD_REQUEST',
        };
      }

      await universityService.delete(parsedId.data.id);
      return { success: true, statusCode: 200, data: { success: true } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const universityController = new UniversityController();
