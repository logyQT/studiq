import type { ParsedCommand } from '../atoms';
import { EXIT_START_FAILED } from '../lib/exit';
import {
  ensureGrafanaToken,
  grafanaAuthLabel,
  grafanaTokenAge,
  inspectGrafana,
  type GrafanaStatus,
} from '../lib/grafana';
import { printJson, writeLine } from '../lib/output';
import { primaryCheckoutPath } from '../lib/repo';

function printStatus(status: GrafanaStatus, mode: 'status' | 'ensure'): void {
  writeLine('▸ Grafana MCP');
  writeLine(`  url        ${status.url}`);
  writeLine(`  auth       ${grafanaAuthLabel(status)}`);
  if (status.state === 'ok') {
    const age = grafanaTokenAge(status.mintedAt);
    writeLine(`  token      ${status.tokenFile}${age ? ` (minted ${age})` : ''}`);
  } else {
    writeLine(`  token      ${status.tokenFile}`);
  }
  writeLine(`  mcp        ${status.mcpBinary ? 'mcp-grafana on PATH' : 'mcp-grafana NOT on PATH'}`);
  if (status.state === 'unreachable') {
    writeLine(`  start      cd "${primaryCheckoutPath()}" && docker compose up -d`);
    writeLine('  note       fix the stack before diagnosing; never substitute a local trace id');
  }
  if (status.detail && !status.ok) writeLine(`  detail     ${status.detail}`);
  if (status.mintError) writeLine(`  mint       failed: ${status.mintError}`);
  if (status.revokedTokenId !== null) {
    writeLine(`  revoked    superseded token ${status.revokedTokenId}`);
  }
  if (status.revokeError)
    writeLine(`  warning    superseded token not revoked: ${status.revokeError}`);
  if (mode === 'ensure' && status.minted) {
    writeLine(
      "  note       run 'opencode service restart' (or start a new session) to pick up the new token",
    );
  }
}

export async function runObservability(parsed: ParsedCommand): Promise<number> {
  const options = parsed.observability ?? { mode: 'status', force: false };
  const status =
    options.mode === 'ensure'
      ? await ensureGrafanaToken({ force: options.force })
      : await inspectGrafana();

  if (parsed.json) {
    printJson(status);
  } else {
    printStatus(status, options.mode);
  }

  if (options.mode === 'ensure' && (!status.ok || status.mintError !== null)) {
    return EXIT_START_FAILED;
  }
  return 0;
}
