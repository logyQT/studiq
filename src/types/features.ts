export const FEATURE_KEYS = [
  'flashcards',
  'quiz',
  'ai',
  'quiz_builder',
  'documents',
  'org_manage',
  'advanced_stats',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface FeatureFlag {
  key: FeatureKey;
  name: string;
  description: string | null;
  isEnabled: boolean;
  rolloutPercentage: number;
}
