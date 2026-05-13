import { CreateUniversitySchema } from '@/server/models';
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
}

export const universityController = new UniversityController();
