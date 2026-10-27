export const queryKeys = {
  featureFlags: {
    all: ['feature-flags'] as const,
    detail: (key: string) => ['feature-flags', key] as const,
  },
  planFeatures: {
    all: ['plan-features'] as const,
  },
  planLimits: {
    all: ['plan-limits'] as const,
    byPlan: (planKey: string) => ['plan-limits', planKey] as const,
  },
  userOverrides: {
    all: ['user-overrides'] as const,
    detail: (id: string) => ['user-overrides', id] as const,
  },
  subscriptionPlans: {
    all: ['subscription-plans'] as const,
    detail: (id: string) => ['subscription-plans', id] as const,
  },
  stats: {
    platform: ['stats', 'platform'] as const,
    daily: (days: number) => ['stats', 'daily', days] as const,
  },
  organizations: {
    all: ['organizations'] as const,
    detail: (id: string) => ['organizations', id] as const,
  },
  users: {
    list: (status: string, page: number, search: string) =>
      ['users', status, page, search] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
  },
} as const;
