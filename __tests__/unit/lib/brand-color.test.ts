import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND_COLOR, isDraftSaved, resolveBrandColor } from '@/lib/brand-color';

// #272: the picker showed the saved colour before the one being picked, so a second change
// snapped back while "Zapisz" still submitted the invisible choice.

describe('resolveBrandColor', () => {
  it('shows the colour being picked over the saved one', () => {
    expect(resolveBrandColor('#3366ff', '#ff5733')).toBe('#3366ff');
  });

  it('shows the saved colour when nothing is being picked', () => {
    expect(resolveBrandColor(null, '#ff5733')).toBe('#ff5733');
  });

  it('falls back to the default when there is neither', () => {
    expect(resolveBrandColor(null, null)).toBe(DEFAULT_BRAND_COLOR);
    expect(resolveBrandColor(null, undefined)).toBe(DEFAULT_BRAND_COLOR);
  });

  it('keeps following every new pick, not just the first', () => {
    expect(resolveBrandColor('#00aa00', '#3366ff')).toBe('#00aa00');
  });
});

describe('isDraftSaved', () => {
  it('is true once the server returns the picked colour', () => {
    expect(isDraftSaved('#3366ff', '#3366ff')).toBe(true);
  });

  it('ignores hex case', () => {
    expect(isDraftSaved('#3366FF', '#3366ff')).toBe(true);
  });

  it('is false while the saved colour is still the old one', () => {
    expect(isDraftSaved('#3366ff', '#ff5733')).toBe(false);
  });

  it('is false without a draft or without a saved colour', () => {
    expect(isDraftSaved(null, '#3366ff')).toBe(false);
    expect(isDraftSaved('#3366ff', null)).toBe(false);
  });
});
