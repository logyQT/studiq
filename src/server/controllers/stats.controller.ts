import { statsService } from '@/server/services';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class StatsController {
  async getTeacherStats(userId: string, subjectId?: string): Promise<ControllerResponse> {
    try {
      const stats = await statsService.getTeacherStats(userId, subjectId);

      return { success: true, statusCode: 200, data: stats };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getStudentStats(userId: string): Promise<ControllerResponse> {
    try {
      const stats = await statsService.getStudentStats(userId);

      return { success: true, statusCode: 200, data: stats };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const statsController = new StatsController();
