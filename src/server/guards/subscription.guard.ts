import type { Nullable } from '@/types';

export type SubscriptionPlan = {
  id: string;
  name: string;
  category: 'premium' | 'org';
  hourlyLimit: number;
  dailyLimit: number;
  monthlyLimit: number;
};

export type SubscriptionCheckResult = {
  allowed: boolean;
  plan: Nullable<SubscriptionPlan>;
  reason?: string;
};

export async function checkSubscription(_userId: string): Promise<SubscriptionCheckResult> {
  return { allowed: true, plan: null };
}
