import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import { wrapService } from '@/lib/observability';
import { isFailure } from '@/lib/service-result';
import { CreateClassroomSchema } from '@/server/models/classroom.model';
import { type ClassroomService, classroomService } from '@/server/services/classroom.service';

export class ClassroomController {
  constructor(private classroomService: ClassroomService) {}

  async create(ctx: RequestContext, body: unknown): Promise<ControllerResponse> {
    const parsed = CreateClassroomSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.classroomService.create(ctx, parsed.data);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.created(result.data);
  }
}
export const classroomController = wrapService(
  new ClassroomController(classroomService),
  'classroom.controller',
);
