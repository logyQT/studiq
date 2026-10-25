import { describe, expect, it } from 'vitest';
import { getFeatureLabel, type PricingTranslator } from '@/lib/pricing-features';

const messages: Record<string, string> = {
  feature_ai_chat: 'Asystent AI',
  feature_quiz: 'Testy',
};
const t = Object.assign((k: string) => messages[k] ?? `PricingPage.${k}`, {
  has: (k: string) => k in messages,
}) as PricingTranslator;

describe('getFeatureLabel', () => {
  it('resolves dotted keys through the underscore message', () => {
    expect(getFeatureLabel('ai.chat', t)).toBe('Asystent AI');
    expect(getFeatureLabel('quiz', t)).toBe('Testy');
  });
  it('humanizes unknown keys', () => {
    expect(getFeatureLabel('custom.thing_x', t)).toBe('Custom thing x');
  });
});
