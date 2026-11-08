import type { ParsedCommand } from '../atoms';
import { suggestFreeAppPort } from '../lib/net';
import { printJson, writeLine } from '../lib/output';
import { readRegistry } from '../lib/registry';

export interface PortsSnapshot {
  appPort: number;
  block: null;
  stackPorts: 'dynamic';
}

/**
 * Suggest a free app port. Phase 1 leases nothing: stack ports are assigned by
 * the CLI and the block allocator arrives in phase 4, so `block` stays null.
 */
export async function runPorts(parsed: ParsedCommand): Promise<number> {
  const registry = readRegistry();
  const appPort = await suggestFreeAppPort(registry.entries);
  const snapshot: PortsSnapshot = { appPort, block: null, stackPorts: 'dynamic' };

  if (parsed.json) {
    printJson(snapshot);
    return 0;
  }

  writeLine(`APP_PORT=${appPort}`);
  writeLine('# Supabase stack ports are assigned per project by the CLI; read them');
  writeLine('# from `bun run env:status` or `bunx supabase status`.');
  return 0;
}
