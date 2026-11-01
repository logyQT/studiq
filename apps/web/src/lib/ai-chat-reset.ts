export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

export interface ResetChatDeps {
  /** `useChat().status` — `submitted`/`streaming` mean a request is still in flight. */
  status: ChatStatus;
  stop: () => void;
  resetMessages: () => void;
  clearError: () => void;
}

/**
 * Reset behind `useAiChat().clearChat` (#378). A response that is still in flight
 * is aborted first so an orphaned answer cannot surface in the fresh transcript.
 *
 * The failure state is cleared too: leaving `hasError` set would re-render
 * `ChatErrorAlert` over the greeting, and its retry calls `regenerate()` with an
 * empty message list.
 *
 * Kept as a plain function so this branch is testable without React Testing
 * Library (the Vitest config is node-only).
 */
export function resetChat({ status, stop, resetMessages, clearError }: ResetChatDeps): void {
  if (status === 'streaming' || status === 'submitted') stop();
  resetMessages();
  clearError();
}
