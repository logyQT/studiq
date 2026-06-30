import { createClient } from '@/lib/supabase/server';
import type { RequestContext } from '@/lib/request-context';

export class FeatureService {
  async checkFeatureAccess(ctx: RequestContext, featureKey: string): Promise<boolean> {
    const supabase = await createClient();

    const { data: feature } = await supabase
      .from('features')
      .select('id')
      .eq('key', featureKey)
      .single();

    if (!feature) return false;

    if (await this.checkPersonalPlan(ctx.userId, ctx.role, feature.id)) return true;

    if (ctx.activeOrgId) {
      if (await this.checkOrgPlan(ctx.activeOrgId, ctx.role, feature.id)) return true;
    }

    return false;
  }

  private async checkPersonalPlan(userId: string, role: string, featureId: string): Promise<boolean> {
    const supabase = await createClient();

    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select('plan_id')
      .eq('user_id', userId)
      .eq('plan_status', 'active')
      .maybeSingle();

    if (!sub?.plan_id) return false;

    return this.checkPlanFeature(sub.plan_id, featureId, role);
  }

  private async checkOrgPlan(orgId: string, role: string, featureId: string): Promise<boolean> {
    const supabase = await createClient();

    const { data: sub } = await supabase
      .from('org_subscriptions')
      .select('plan_id')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .maybeSingle();

    if (!sub?.plan_id) return false;

    return this.checkPlanFeature(sub.plan_id, featureId, role);
  }

  private async checkPlanFeature(planId: string, featureId: string, role: string): Promise<boolean> {
    const supabase = await createClient();

    const { data } = await supabase
      .from('plan_features')
      .select('allowed_roles')
      .eq('plan_id', planId)
      .eq('feature_id', featureId)
      .maybeSingle();

    if (!data) return false;
    if (data.allowed_roles.length === 0) return true;
    return data.allowed_roles.includes(role);
  }
}

export const featureService = new FeatureService();
