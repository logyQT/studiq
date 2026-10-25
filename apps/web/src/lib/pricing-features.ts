/** Minimal translator shape (next-intl `useTranslations('PricingPage')`). */
export type PricingTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

/**
 * Human readable label for a plan feature key such as `ai.chat`.
 * next-intl treats `.` as nesting, so the key is normalized to `ai_chat`
 * before the lookup. Unknown keys fall back to a humanized form
 * ("some.new_feature" -> "Some new feature"), never a raw message id.
 */
export function getFeatureLabel(key: string, t: PricingTranslator): string {
  const normalized = key.replace(/[.\s-]+/g, '_');
  const messageKey = `feature_${normalized}`;
  if (t.has(messageKey)) return t(messageKey);
  const words = normalized.replace(/_+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}
