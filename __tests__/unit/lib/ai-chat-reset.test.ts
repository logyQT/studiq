import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resetChat } from '@/lib/ai-chat-reset';

/**
 * `useAiChat().clearChat` must abort a request that is still in flight before it
 * empties the transcript — otherwise an orphaned answer can surface in the fresh
 * conversation. The decision lives in `resetChat` so it is testable without React
 * Testing Library (the Vitest config is node-only).
 */
describe('resetChat', () => {
  it('aborts an in-flight response when a stream is running', () => {
    const stop = vi.fn();
    const resetMessages = vi.fn();
    const clearError = vi.fn();

    resetChat({ status: 'streaming', stop, resetMessages, clearError });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(resetMessages).toHaveBeenCalledTimes(1);
    expect(clearError).toHaveBeenCalledTimes(1);
    // Abort before the list is emptied: `stop()` is what keeps the in-flight
    // answer from landing in the fresh conversation.
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
      resetMessages.mock.invocationCallOrder[0],
    );
    expect(resetMessages.mock.invocationCallOrder[0]).toBeLessThan(
      clearError.mock.invocationCallOrder[0],
    );
  });

  it('aborts the request that has been submitted but has not started streaming', () => {
    const stop = vi.fn();
    const resetMessages = vi.fn();
    const clearError = vi.fn();

    resetChat({ status: 'submitted', stop, resetMessages, clearError });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
      resetMessages.mock.invocationCallOrder[0],
    );
    expect(resetMessages).toHaveBeenCalledTimes(1);
    expect(clearError).toHaveBeenCalledTimes(1);
  });

  it('does not abort an idle conversation', () => {
    const stop = vi.fn();
    const resetMessages = vi.fn();
    const clearError = vi.fn();

    resetChat({ status: 'ready', stop, resetMessages, clearError });

    expect(stop).not.toHaveBeenCalled();
    expect(resetMessages).toHaveBeenCalledTimes(1);
    expect(clearError).toHaveBeenCalledTimes(1);
  });

  it('clears the error state after a failed send', () => {
    const stop = vi.fn();
    const resetMessages = vi.fn();
    const clearError = vi.fn();

    resetChat({ status: 'error', stop, resetMessages, clearError });

    expect(stop).not.toHaveBeenCalled();
    expect(resetMessages).toHaveBeenCalledTimes(1);
    // Leaving `hasError` set would keep `ChatErrorAlert` (and its `regenerate()`
    // retry) mounted over the greeting, with an empty message list.
    expect(clearError).toHaveBeenCalledTimes(1);
    expect(resetMessages.mock.invocationCallOrder[0]).toBeLessThan(
      clearError.mock.invocationCallOrder[0],
    );
  });
});

/**
 * `resetChat` is only worth testing if the product code actually calls it, and if
 * both reset controls stay mounted while the greeting shows. These readers guard
 * the two blocking review findings on #378 without pulling in a React renderer:
 *
 * - the hook must delegate to `resetChat({ status, stop, … })` instead of
 *   clearing with a bare `setMessages(() => [])` (which skips the abort);
 * - `ai-chat-screen.tsx` must render `new_chat` / `clear_chat` before the
 *   `{isActive && (` branch, because STU-47 step 3 clicks „Wyczyść czat" right
 *   after „Nowa rozmowa" has emptied the conversation.
 */
const WEB_SRC = 'apps/web/src';

function read(relPath: string): string {
  return fs.readFileSync(path.join(WEB_SRC, relPath), 'utf8').replace(/\r\n/g, '\n');
}

describe('AI chat reset wiring (#378)', () => {
  it('clearChat delegates to resetChat and never clears with a bare setMessages', () => {
    const src = read('hooks/use-ai-chat.ts');
    const start = src.indexOf('const clearChat = useCallback(');
    expect(start, 'clearChat must exist in use-ai-chat.ts').toBeGreaterThanOrEqual(0);
    // The slice ends at the next hook the file declares, so it holds only clearChat.
    const end = src.indexOf('const retry = useCallback(', start);
    expect(end, 'clearChat must be followed by the retry callback').toBeGreaterThan(start);
    const body = src.slice(start, end);

    expect(body).toMatch(/resetChat\(\{[^}]*\bstatus\b[^}]*\bstop\b[^}]*\bclearError\b[^}]*\}\)/);
    // After removing the delegation, no remaining statement may empty the list
    // directly — that was the shape of the regression (no abort, stale error).
    const withoutDelegation = body.replace(/resetChat\([\s\S]*?\);/g, '');
    expect(withoutDelegation).not.toMatch(/\bsetMessages\(/);
    expect(withoutDelegation).not.toMatch(/\bstop\(\)/);
  });

  it('both reset controls render before the active-only branch in the chat screen', () => {
    const src = read('components/ai/ai-chat-screen.tsx');

    const newChat = src.indexOf("t('new_chat')");
    const clearChat = src.indexOf("t('clear_chat')");
    const activeBranch = src.indexOf('{isActive && (');
    const lockedReturn = src.indexOf('return <AiChatLockedState />');

    expect(newChat, 'new_chat button must be rendered').toBeGreaterThanOrEqual(0);
    expect(clearChat, 'clear_chat button must be rendered').toBeGreaterThanOrEqual(0);
    expect(activeBranch, 'the isActive branch must exist').toBeGreaterThanOrEqual(0);
    expect(lockedReturn, 'the plan gate must exist').toBeGreaterThanOrEqual(0);

    // Inside `{isActive && …}` both buttons would unmount on reset, which is
    // exactly what made „Wyczyść czat" unreachable after „Nowa rozmowa".
    expect(newChat).toBeLessThan(activeBranch);
    expect(clearChat).toBeLessThan(activeBranch);
    // …and above the plan gate they would render for an account that cannot chat.
    expect(newChat).toBeGreaterThan(lockedReturn);
    expect(clearChat).toBeGreaterThan(lockedReturn);
  });
});
