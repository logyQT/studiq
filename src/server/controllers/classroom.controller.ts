import { CreateClassroomSchema } from '@/server/models/classroom.model';
import { classroomService } from '@/server/services/classroom.service';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class ClassroomController {
  async create(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreateClassroomSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const classroom = await classroomService.create(ctx, parsed.data);
      return { success: true, statusCode: 201, data: classroom };
    }, ctx);
  }
}

export const classroomController = new ClassroomController();
