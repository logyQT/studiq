/**
 * `plan_limits.limit_key` for the daily AI token budget.
 *
 * Lives in a plain config module (no service imports) so both the chat route
 * and the read-only usage endpoint resolve the same key without pulling the
 * limits resolver into every consumer.
 */
export const AI_TOKENS_LIMIT_KEY = 'max_ai_tokens_per_day';
