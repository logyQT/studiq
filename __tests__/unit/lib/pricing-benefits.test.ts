import { describe, expect, it } from 'vitest';
import {
  FEATURE_PRIORITY,
  getHighlightedFeatures,
  sortFeaturesByPriority,
} from '@/lib/pricing-benefits';

describe('sortFeaturesByPriority', () => {
  it('orders known keys by the fixed priority list', () => {
    expect(
      sortFeaturesByPriority(['quiz', 'branding', 'ai.chat', 'advanced.stats', 'flashcards']),
    ).toEqual(['ai.chat', 'advanced.stats', 'branding', 'flashcards', 'quiz']);
  });

  it('appends unknown keys alphabetically after the known ones', () => {
    expect(sortFeaturesByPriority(['zeta.feature', 'ai.chat', 'alpha.feature'])).toEqual([
      'ai.chat',
      'alpha.feature',
      'zeta.feature',
    ]);
  });

  it('de-dupes while keeping one copy in priority order', () => {
    expect(sortFeaturesByPriority(['quiz', 'quiz', 'ai.chat', 'ai.chat'])).toEqual([
      'ai.chat',
      'quiz',
    ]);
  });

  it('returns an empty list for no features', () => {
    expect(sortFeaturesByPriority([])).toEqual([]);
  });

  it('keeps every priority key discoverable', () => {
    expect(sortFeaturesByPriority(FEATURE_PRIORITY)).toEqual([...FEATURE_PRIORITY]);
  });
});

describe('getHighlightedFeatures', () => {
  it('caps the list at five by default', () => {
    const features = [
      'quiz',
      'flashcards',
      'member.manage',
      'group.manage',
      'branding',
      'role.builder',
      'documents',
      'advanced.stats',
      'quiz.builder',
      'ai.chat',
    ];
    expect(getHighlightedFeatures(features)).toEqual([
      'ai.chat',
      'quiz.builder',
      'advanced.stats',
      'documents',
      'role.builder',
    ]);
  });

  it('does not pad a short list', () => {
    expect(getHighlightedFeatures(['branding', 'quiz'])).toEqual(['branding', 'quiz']);
  });

  it('returns an empty list for no features', () => {
    expect(getHighlightedFeatures([])).toEqual([]);
  });

  it('keeps the first five bullets stable when the list is expanded', () => {
    const features = [
      'quiz',
      'member.manage',
      'ai.chat',
      'custom.feature',
      'documents',
      'branding',
      'omega.feature',
    ];
    const highlighted = getHighlightedFeatures(features);
    const expanded = sortFeaturesByPriority(features);
    expect(expanded.length).toBeGreaterThan(highlighted.length);
    expect(expanded.slice(0, 5)).toEqual(highlighted);
  });
});
