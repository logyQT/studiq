import type { RequestContext } from '@studiq/authz';
import { can, Permission } from '@studiq/server/lib/authz';
import {
  controllerResponse,
  type ControllerResponse,
} from '@studiq/server/lib/controller-response';
import { requireEntitlement } from '@studiq/server/lib/entitlements';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  TeacherDashboardQuerySchema,
  TeacherStatsQuerySchema,
} from '@studiq/server/models/stats.model';
import { type StatsService, statsService } from '@studiq/server/services/stats.service';

export class StatsController {
  constructor(private service: StatsService) {}

  async getTeacherStats(query: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    if (!(await can(ctx, Permission.STATS_READ))) return controllerResponse.error('FORBIDDEN');
    const parsed = TeacherStatsQuerySchema.safeParse(query);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.service.getTeacherStats(ctx, parsed.data);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getStudentStats(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.getStudentStats(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getTeacherQuizStats(ctx: RequestContext): Promise<ControllerResponse> {
    if (!(await can(ctx, Permission.STATS_READ))) return controllerResponse.error('FORBIDDEN');
    const result = await this.service.getTeacherQuizStats(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getActivity(
    ctx: RequestContext,
    range?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<ControllerResponse> {
    const result = await this.service.getActivity(ctx, range, startDate, endDate);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getWeakPoints(ctx: RequestContext): Promise<ControllerResponse> {
    // Diagnostic (why / what to do) is the paid `stats.insights` surface (phase 5d);
    // the descriptive reads stay open. First statement, before the service — the
    // `ai/chat` precedent.
    await requireEntitlement(ctx, 'stats.insights');
    const result = await this.service.getWeakPoints(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  /**
   * The shared prelude of the two teacher-dashboard reads: the paid
   * `stats.insights` gate (phase 5d), then `stats.read`, then the query parse —
   * one definition, so the two methods cannot drift apart.
   */
  private async teacherDashboardGate(
    query: unknown,
    ctx: RequestContext,
  ): Promise<
    | { ok: true; data: { days: number; limit: number } }
    | { ok: false; response: ControllerResponse }
  > {
    await requireEntitlement(ctx, 'stats.insights');
    if (!(await can(ctx, Permission.STATS_READ))) {
      return { ok: false, response: controllerResponse.error('FORBIDDEN') };
    }
    const parsed = TeacherDashboardQuerySchema.safeParse(query ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        response: controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues),
      };
    }
    return { ok: true, data: parsed.data };
  }

  async getTeacherGroupPerformance(
    query: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const gate = await this.teacherDashboardGate(query, ctx);
    if (!gate.ok) return gate.response;

    const result = await this.service.getTeacherGroupPerformance(ctx, gate.data.days);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getTeacherActivityFeed(query: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const gate = await this.teacherDashboardGate(query, ctx);
    if (!gate.ok) return gate.response;

    const result = await this.service.getTeacherActivityFeed(ctx, gate.data.limit);
    return isFailure(result)
      ? controllerResponse.error(result.error)
      : controllerResponse.success(result.data);
  }
}
export const statsController = wrapService(new StatsController(statsService), 'stats.controller');
