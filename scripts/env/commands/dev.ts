import type { ParsedCommand } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EnvFailure } from '../lib/exit';
import { readContract } from '../lib/contract';
import { contractWithLease } from '../lib/contract-lease';
import { pidAlive, withCheckoutLock } from '../lib/locks';
import { probePortBind } from '../lib/net';
import { probeHttp } from '../lib/health';
import { resolveLocalAppEnv } from '../lib/app-env';
import { startDevServer, stopWebServer, webLogPath } from '../lib/web';
import { liveServerConflict } from '../lib/web-owner';
import { appendEnvLog } from '../lib/state';
import { printJson, writeStderrLine } from '../lib/output';
import { runEnsure } from './ensure';

/** The stack-only `ensure` that runs before HMR (no build, no serve). */
function stackOnly(parsed: ParsedCommand): ParsedCommand {
  const options = parsed.dev;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'dev options are missing');
  return {
    ...parsed,
    command: 'ensure',
    json: false,
    quiet: true,
    passthrough: [],
    ensure: {
      profile: 'full',
      capabilityAtoms: options.capabilityAtoms,
      seed: 'no-seed',
      build: false,
      serve: false,
      forceBuild: false,
      runtime: options.runtime,
      stack: options.stack,
      appPort: null,
      waitSeconds: options.waitSeconds,
    },
    down: null,
    build: null,
    serve: null,
    dev: null,
    resetDb: null,
    logs: null,
    setup: null,
    verify: null,
  };
}

/**
 * Human-only HMR (`next dev`). Agents never run this; they use build + serve,
 * so this command is the one place the tool starts `next dev`.
 *
 * It first ensures the stack (no build/serve), then takes the checkout lock,
 * stops this checkout's existing server, and starts HMR. Without `--json` the
 * HMR output stays in the terminal; with `--json` it goes to `.dev/web.log` and
 * one startup contract is printed to stdout.
 */
export async function runDev(parsed: ParsedCommand): Promise<number> {
  const options = parsed.dev;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'dev options are missing');
  resolveLocalAppEnv();
  appendEnvLog('dev: profile=full (human-only HMR)');

  const ensured = await runEnsure(stackOnly(parsed));
  if (ensured !== 0) return ensured;

  const base = readContract();
  const stackName = options.stack ?? base.stackName;
  const contract = contractWithLease({ ...base, stackName });
  process.env.APP_PORT = String(contract.appPort);
  process.env.APP_URL = contract.appUrl;
  process.env.NEXT_PUBLIC_SITE_URL ||= contract.appUrl;

  const handle = await withCheckoutLock(async () => {
    const conflict = liveServerConflict(
      { stackName: stackName ?? 'default', profile: 'full' },
      'start',
    );
    if (conflict) throw new EnvFailure(EXIT_CONFLICT, conflict);
    // One environment per checkout: HMR replaces the recorded server.
    stopWebServer();
    const bind = await probePortBind(contract.appPort);
    if (bind.state !== 'free') {
      throw new EnvFailure(
        bind.state === 'in-use' ? EXIT_CONFLICT : EXIT_START_FAILED,
        `port ${contract.appPort} cannot be bound (${bind.error ?? bind.state}); free it or use a separate worktree`,
      );
    }
    return startDevServer({
      appPort: contract.appPort,
      appUrl: contract.appUrl,
      env: process.env,
      foreground: !parsed.json,
    });
  });

  const deadline = Date.now() + 180_000;
  let http = 0;
  while (Date.now() < deadline) {
    if (!pidAlive(handle.pid)) {
      stopWebServer();
      throw new EnvFailure(
        EXIT_START_FAILED,
        `HMR exited before answering on ${contract.appUrl}; see ${webLogPath()}`,
      );
    }
    http = await probeHttp(contract.appUrl);
    if (http >= 200 && http < 400) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (http < 200 || http >= 400) {
    stopWebServer();
    throw new EnvFailure(
      EXIT_START_FAILED,
      `HMR did not answer on ${contract.appUrl} within 180s; see ${webLogPath()}`,
    );
  }

  if (parsed.json) {
    printJson({
      ready: true,
      target: 'web',
      profile: 'full',
      url: contract.appUrl,
      pid: handle.pid,
      log: '.dev/web.log',
      humanOnly: true,
    });
  } else if (!parsed.quiet) {
    writeStderrLine(`env: dev ready — ${contract.appUrl} (pid ${handle.pid}, web HMR)`);
    writeStderrLine('  human-only: agents use `bun run env:build` + `bun run env:serve`');
  }

  const cleanup = (): void => {
    stopWebServer();
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  const code = await handle.exit;
  process.removeListener('SIGINT', cleanup);
  process.removeListener('SIGTERM', cleanup);
  return code ?? 0;
}
