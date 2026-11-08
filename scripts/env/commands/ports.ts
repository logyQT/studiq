import { lstatSync } from 'node:fs';
import type { ParsedCommand } from '../atoms';
import { suggestFreeAppPort } from '../lib/net';
import { printJson, writeLine, writeStderrLine } from '../lib/output';
import { readRegistry } from '../lib/registry';

export interface PortsSnapshot {
  appPort: number;
  block: null;
  stackPorts: 'dynamic';
}

function registryPathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Suggest a free app port. Phase 1 leases nothing: stack ports are assigned by
 * the CLI and the block allocator arrives in phase 4, so `block` stays null.
 *
 * A registry that exists but is not a trusted private directory cannot be read,
 * so suggestions could collide with another checkout's claimed port. That is an
 * ownership conflict (exit 6), not an empty registry; a missing registry is
 * normal and still gets a suggestion.
 */
export async function runPorts(parsed: ParsedCommand): Promise<number> {
  const registry = readRegistry();
  if (!registry.trusted && registryPathExists(registry.dir)) {
    writeStderrLine(
      `env:ports: refusing to suggest a port: ${registry.dir} exists but is not a trusted ` +
        'private directory (symlink, not a directory, or not owned by you). ' +
        'Fix it or set STUDIQ_DEV_REGISTRY to a private path.',
    );
    return 6;
  }

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
