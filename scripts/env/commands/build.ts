import type { ParsedCommand } from '../atoms';
import { EXIT_CONFLICT, EXIT_START_FAILED, EXIT_TIMEOUT, EnvFailure } from '../lib/exit';
import { readContract } from '../lib/contract';
import { contractWithLease } from '../lib/contract-lease';
import {
  appendEnvLog,
  buildArtifactPresent,
  readBuildState,
  readStackRecord,
  writeBuildState,
  writeStackRecord,
} from '../lib/state';
import { runBuildUnderLock } from '../lib/locks';
import { probeHttp } from '../lib/health';
import { readStack, type StackEnv, type StackStatus } from '../lib/stack';
import { applyStackEnv } from '../lib/stack-lifecycle';
import { readWebPid } from '../lib/web';
import { REPO_ROOT } from '../lib/repo';
import { printJson, writeStderrLine } from '../lib/output';
import { collectSnapshot, stateKeyFor } from '../lib/snapshot';
import { BUILD_MODE, buildEnvHash, computeBuildFingerprint } from '../lib/fingerprint';
import { normalizeLocalhost, trimTrailingSlash } from '../lib/urls';

const SECRET_LINE_RE = /(?:KEY|SECRET|PASSWORD|TOKEN)\s*=\s*\S|eyJ[A-Za-z0-9_-]{10,}/;

function logBuildOutput(output: string): void {
  const lines = output
    .split('\n')
    .filter((line) => line.trim().length > 0 && !SECRET_LINE_RE.test(line));
  for (const line of lines.slice(-40)) appendEnvLog(`build: ${line.slice(0, 500)}`);
}

function sharedStackEnv(): StackEnv {
  const apiUrl = normalizeLocalhost(trimTrailingSlash(process.env.SUPABASE_URL ?? ''));
  return {
    apiUrl,
    restUrl: apiUrl ? `${apiUrl}/rest/v1` : null,
    dbUrl: process.env.SUPABASE_DB_URL ?? null,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    publishableKey: null,
    secretKey: null,
    mailUrl: process.env.SUPABASE_MAIL_URL ?? null,
    studioUrl: process.env.SUPABASE_STUDIO_URL ?? null,
  };
}

function human(parsed: ParsedCommand, lines: string[]): void {
  if (parsed.json || parsed.quiet) return;
  for (const line of lines) writeStderrLine(line);
}

export async function runBuild(parsed: ParsedCommand): Promise<number> {
  const options = parsed.build;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'build options are missing');
  const contract = contractWithLease(readContract());
  process.env.APP_PORT = String(contract.appPort);
  process.env.APP_URL = contract.appUrl;
  process.env.NEXT_PUBLIC_SITE_URL ||= contract.appUrl;
  appendEnvLog(`build: shared=${contract.shared} force=${options.force}`);

  if (readWebPid()) {
    throw new EnvFailure(
      EXIT_CONFLICT,
      "the web server is running; stop it with 'env:down' before an explicit build",
    );
  }

  let stack: StackStatus | null = null;
  let stackEnv: StackEnv;
  if (contract.shared) {
    const missing = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].filter(
      (name) => !process.env[name],
    );
    if (missing.length > 0) {
      throw new EnvFailure(
        EXIT_START_FAILED,
        `SUPABASE_SHARED=1 needs ${missing.join(', ')} in .env.local (or the process environment)`,
      );
    }
    stackEnv = sharedStackEnv();
    if (!stackEnv.apiUrl || (await probeHttp(`${stackEnv.apiUrl}/auth/v1/health`)) !== 200) {
      throw new EnvFailure(EXIT_START_FAILED, 'the shared Supabase stack is not healthy');
    }
  } else {
    const read = readStack(contract.stackName);
    if (!read) {
      throw new EnvFailure(
        EXIT_START_FAILED,
        "no running Supabase stack for this checkout; run 'env:ensure --profile api' first (the build inlines this stack's NEXT_PUBLIC_* values)",
      );
    }
    stack = read.status;
    stackEnv = read.env;
  }

  const rawAppEnv = (process.env.APP_ENV ?? '').trim().toLowerCase();
  const appEnv = rawAppEnv || 'development';
  if (appEnv !== 'development' && appEnv !== 'test' && appEnv !== 'qa') {
    throw new EnvFailure(
      EXIT_START_FAILED,
      `APP_ENV='${appEnv}' cannot build this local checkout (set development, test or qa)`,
    );
  }
  applyStackEnv(stackEnv, {
    appUrl: contract.appUrl,
    appEnv,
    stackId: stack?.id,
  });

  const envHash = buildEnvHash({
    supabaseUrl: stackEnv.apiUrl,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || contract.appUrl,
    anonKey: stackEnv.anonKey ?? '',
  });
  const fingerprint = computeBuildFingerprint({ root: REPO_ROOT, mode: BUILD_MODE, envHash });
  const state = readBuildState();
  const current = state?.envHash === envHash && state?.fingerprint === fingerprint;

  let built = false;
  if (options.force || !current || !buildArtifactPresent()) {
    appendEnvLog('build: building @studiq/web');
    const result = runBuildUnderLock({ env: process.env });
    if (result.timedOut) {
      throw new EnvFailure(EXIT_TIMEOUT, 'timed out waiting for the cross-worktree build lock');
    }
    if (!result.ok) {
      logBuildOutput(result.output);
      throw new EnvFailure(
        EXIT_START_FAILED,
        `build failed (exit ${result.exitCode ?? 'unknown'}); see .dev/env.log`,
      );
    }
    writeBuildState({
      fingerprint,
      envHash,
      mode: BUILD_MODE,
      builtAt: new Date().toISOString(),
    });
    built = true;
    appendEnvLog('build: complete');
  } else {
    appendEnvLog('build: already current');
  }

  const record = readStackRecord(stateKeyFor(contract.stackName));
  if (record) {
    writeStackRecord(stateKeyFor(contract.stackName), {
      ...record,
      envHash,
      updatedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    });
  }

  const snapshot = await collectSnapshot({
    contract,
    stack,
    record,
    skipStackLookup: true,
  });
  if (parsed.json) printJson(snapshot);
  else
    human(parsed, [
      built ? 'Build complete.' : 'Build is already current.',
      `fingerprint ${fingerprint.slice(0, 12)}`,
    ]);
  return 0;
}
