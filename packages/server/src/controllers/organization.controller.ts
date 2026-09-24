import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { requireFeature } from '@studiq/server/lib/features';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  CreateOrganizationSchema,
  OrganizationIdParamsSchema,
  UpdateOrganizationSchema,
} from '@studiq/server/models/organization.model';
import {
  type OrganizationService,
  organizationService,
} from '@studiq/server/services/organization.service';

export class OrganizationController {
  constructor(private organizationService: OrganizationService) {}

  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsedData = CreateOrganizationSchema.safeParse(body);

    if (!parsedData.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsedData.error.issues,
      };
    }

    const result = await this.organizationService.create(ctx, parsedData.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.created(result.data);
  }

  async createAsMember(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsedData = CreateOrganizationSchema.safeParse(body);

    if (!parsedData.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsedData.error.issues,
      };
    }

    const result = await this.organizationService.createAndJoin(ctx, parsedData.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.created(result.data);
  }

  async getAll(): Promise<ControllerResponse> {
    const organizations = await this.organizationService.getAll();

    if (isFailure(organizations)) {
      return controllerResponse.error(organizations.error);
    }

    return controllerResponse.success(organizations.data);
  }

  async getById(id: string): Promise<ControllerResponse> {
    const parsedId = OrganizationIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return {
        success: false,
        statusCode: 400,
        error: 'BAD_REQUEST',
      };
    }

    const organization = await this.organizationService.getById(parsedId.data.id);

    if (isFailure(organization)) {
      return controllerResponse.error(organization.error);
    }

    return controllerResponse.success(organization.data);
  }

  async update(ctx: RequestContext, id: string, body: unknown): Promise<ControllerResponse> {
    // Branding is plan-gated, but a plain org rename is not — only gate the
    // request when it actually carries branding fields. Checked on the raw
    // body (before validation) so a disabled feature fails closed rather than
    // leaking a 422 for a payload the org was never allowed to send.
    const rawBody =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if ('logoUrl' in rawBody || 'brandColor' in rawBody) {
      await requireFeature(ctx, 'branding');
    }

    const parsedId = OrganizationIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return {
        success: false,
        statusCode: 400,
        error: 'BAD_REQUEST',
      };
    }

    const parsedData = UpdateOrganizationSchema.safeParse(body);
    if (!parsedData.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsedData.error.issues,
      };
    }

    const result = await this.organizationService.update(parsedId.data.id, parsedData.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getDetails(id: string): Promise<ControllerResponse> {
    const parsedId = OrganizationIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return {
        success: false,
        statusCode: 400,
        error: 'BAD_REQUEST',
      };
    }

    const detail = await this.organizationService.getByIdWithDetails(parsedId.data.id);

    if (isFailure(detail)) {
      return controllerResponse.error(detail.error);
    }

    return controllerResponse.success(detail.data);
  }

  async delete(id: string): Promise<ControllerResponse> {
    const parsedId = OrganizationIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return {
        success: false,
        statusCode: 400,
        error: 'BAD_REQUEST',
      };
    }

    const result = await this.organizationService.delete(parsedId.data.id);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }
}
export const organizationController = wrapService(
  new OrganizationController(organizationService),
  'organization.controller',
);
