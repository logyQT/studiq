import { CreateUniversitySchema, UpdateUniversitySchema, UniversityIdParamsSchema } from '@/server/models';
import { universityService } from '@/server/services';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';

export class UniversityController {
  async create(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
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
    });
  }

  async getAll(): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const universities = await universityService.getAll();
      return { success: true, statusCode: 200, data: universities };
    });
  }

  async getById(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
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
    });
  }

  async update(id: string, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
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
    });
  }

  async delete(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
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
    });
  }
}

export const universityController = new UniversityController();
