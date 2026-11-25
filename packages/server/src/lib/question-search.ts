/**
 * The longest `search` the question list accepts, in code points (how Zod's `max` counts).
 * In a module of its own, free of server imports, because the browser cuts a deep-linked
 * search to the same length.
 */
export const QUESTION_SEARCH_MAX_LENGTH = 100;
