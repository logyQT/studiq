import type { SubscriptionPlan } from './subscription.guard';

export type UsageCheckResult = {
  allowed: boolean;
  current: { hourly: number; daily: number; monthly: number };
  limits: { hourly: number; daily: number; monthly: number };
  resetsAt: { hourly: string; daily: string; monthly: string };
};

export async function checkUsage(
  _userId: string,
  _actionType: string,
  _plan: SubscriptionPlan | null,
): Promise<UsageCheckResult> {
  return {
    allowed: true,
    current: { hourly: 0, daily: 0, monthly: 0 },
    limits: { hourly: Infinity, daily: Infinity, monthly: Infinity },
    resetsAt: { hourly: '', daily: '', monthly: '' },
  };
}
