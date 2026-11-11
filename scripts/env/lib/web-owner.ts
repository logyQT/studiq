import { readStackState } from './state';
import { readWebPid } from './web';

/** Simple live-server attribution from the checkout's stack state. */
export function liveServerConflict(
  requested: { stackName: string; profile: string | null },
  operation: 'start' | 'rebuild',
): string | null {
  const pid = readWebPid();
  if (!pid) return null;
  const state = readStackState();
  const action = operation === 'start' ? 'start another environment' : 'rebuild apps/web/.next';
  if (!state?.stackName || !state.profile || !requested.profile) {
    return `web server pid ${pid} is running but its stack/profile cannot be determined; refusing to ${action} — run 'env:down' first, or use a separate worktree.`;
  }
  if (state.stackName === requested.stackName && state.profile === requested.profile) return null;
  return `web server pid ${pid} is serving stack '${state.stackName}' (profile ${state.profile}); refusing to ${action} for stack '${requested.stackName}' (profile ${requested.profile}) — run 'env:down' first, or use a separate worktree.`;
}
