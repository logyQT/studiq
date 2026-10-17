/**
 * StudiQ load-test traffic generator.
 *
 * Spawns N concurrent "bot" users. Each bot logs in through the app (so it
 * gets real Supabase session cookies and produces real auth traffic), then
 * loops a role-appropriate weighted journey — browsing decks, practising
 * flashcards, checking stats, occasionally creating content — until the run
 * duration elapses.
 *
 * Concurrency model:
 *   - `--users 50` means 50 *simultaneously active* users, each looping
 *     (action → think → action …). It is NOT 50 total requests.
 *   - `--shards 16` forks the runner into 16 OS processes (one per core), each
 *     driving `users / shards` bots, and aggregates the results. This keeps the
 *     client off the critical path on many-core machines.
 *
 * Every response is captured, including its `x-trace-id` header, so failures
 * can be traced straight into Tempo from the printed summary.
 *
 * Usage:
 *   bun scripts/load-test/bots.ts --users 50 --duration 300
 *   bun scripts/load-test/bots.ts --users 50 --duration 300 --shards 16   # all cores
 *   bun scripts/load-test/bots.ts --users 5  --duration 30                # smoke test
 *
 * Prerequisites:
 *   - Supabase + the app running, telemetry pointed at the OTel Collector
 *   - run the app with `next build && next start` for meaningful throughput
 *     (dev mode caps out around 30 req/s)
 *   - `bun scripts/load-test/seed.ts` has produced .dev/load-test/accounts.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  type AccountRecord,
  AppClient,
  argBool,
  argNum,
  argStr,
  createRng,
  mapLimit,
  parseArgs,
  randInt,
  resolveConfig,
  Stats,
  sleep,
} from './config';
import { type Action, actionsFor, type BotState, pickWeightedAction } from './journeys';

interface Pool {
  password: string;
  accounts: AccountRecord[];
}

interface RunOptions {
  users: number;
  totalUsers: number;
  shardOffset: number;
  durationSec: number;
  studentShare: number;
  thinkMin: number;
  thinkMax: number;
  loginConcurrency: number;
  seed: number;
  shardIndex: number;
  shards: number;
  reportPath?: string;
}

interface ShardReport {
  bots: number;
  requests: number;
  elapsedSec: number;
  total: number;
  errors: number;
  networkErrors: number;
  withTraceId: number;
  statuses: [number, number][];
  perAction: [string, { count: number; ok: number; err: number; totalMs: number }][];
  latencies: number[];
  failingTraces: { traceId: string; action: string; status: number }[];
}

async function loadPool(path: string): Promise<Pool> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as Pool;
  if (!Array.isArray(parsed.accounts) || parsed.accounts.length === 0) {
    throw new Error(`No accounts in ${path} — run scripts/load-test/seed.ts first.`);
  }
  return parsed;
}

/** Choose `count` accounts, biased so the requested share are students. */
function selectBots(
  pool: AccountRecord[],
  count: number,
  studentShare: number,
  rng: () => number,
): AccountRecord[] {
  const shuffle = <T>(items: T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const students = shuffle(pool.filter((a) => a.accountType === 'student'));
  const others = shuffle(pool.filter((a) => a.accountType !== 'student'));
  const studentTarget = Math.min(students.length, Math.round(count * studentShare));

  const chosen = [...students.slice(0, studentTarget), ...others.slice(0, count - studentTarget)];
  const chosenEmails = new Set(chosen.map((a) => a.email));
  for (const account of shuffle(pool)) {
    if (chosen.length >= count) break;
    if (!chosenEmails.has(account.email)) {
      chosen.push(account);
      chosenEmails.add(account.email);
    }
  }
  return chosen.slice(0, count);
}

async function loginWithBackoff(
  client: AppClient,
  account: AccountRecord,
  maxAttempts = 12,
): Promise<number> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await client.login(account.email, account.password);
    if (result.ok) return result.status;
    if (result.status === 429 && attempt < maxAttempts) {
      await sleep(Math.min(30_000, 2_000 * attempt));
      continue;
    }
    if (result.status === 0 && attempt < maxAttempts) {
      await sleep(500 * attempt);
      continue;
    }
    return result.status;
  }
  return 429;
}

interface BotRuntime {
  account: AccountRecord;
  client: AppClient;
  actions: Action[];
  state: BotState;
  requests: number;
}

function serialize(stats: Stats, runtimes: BotRuntime[], elapsedSec: number): ShardReport {
  return {
    bots: runtimes.length,
    requests: runtimes.reduce((sum, r) => sum + r.requests, 0),
    elapsedSec,
    total: stats.total,
    errors: stats.errors,
    networkErrors: stats.networkErrors,
    withTraceId: stats.withTraceId,
    statuses: [...stats.statuses.entries()],
    perAction: [...stats.perAction.entries()],
    latencies: stats.latencies,
    failingTraces: stats.failingTraces,
  };
}

async function runShard(config: ReturnType<typeof resolveConfig>, pool: Pool, opts: RunOptions) {
  // Deterministic shuffle shared by all shards → each shard takes a disjoint
  // slice of the exact `totalUsers`, so the sum of the shards == requested users.
  const all = selectBots(pool.accounts, opts.totalUsers, opts.studentShare, createRng(opts.seed));
  const chosen = all.slice(opts.shardOffset, opts.shardOffset + opts.users);

  const stats = new Stats();
  const clients = new Map<string, AppClient>();

  const loginResults = await mapLimit(chosen, opts.loginConcurrency, async (account) => {
    const client = new AppClient(config.appUrl);
    clients.set(account.email, client);
    const status = await loginWithBackoff(client, account);
    return { account, status };
  });
  const loggedIn = loginResults.filter((r) => r.status === 200);

  const runtimes: BotRuntime[] = loggedIn.map(({ account }) => {
    const client = clients.get(account.email)!;
    const state: BotState = {
      client,
      account,
      rng: createRng((opts.seed + account.index * 2654435761) >>> 0),
      deckIds: [],
      topicIds: [],
      cardIds: [],
      lastDeckId: null,
    };
    return { account, client, actions: actionsFor(account.accountType), state, requests: 0 };
  });

  let stopping = false;
  const deadline = Date.now() + opts.durationSec * 1000;
  process.on('SIGINT', () => {
    stopping = true;
  });

  const startedAt = Date.now();
  await Promise.all(
    runtimes.map(async (runtime) => {
      while (!stopping && Date.now() < deadline) {
        const action = pickWeightedAction(runtime.state.rng, runtime.state, runtime.actions);
        try {
          const outcome = await action.run(runtime.state);
          const results = Array.isArray(outcome) ? outcome : [outcome];
          stats.recordMany(results);
          runtime.requests += results.length;
        } catch (error) {
          stats.record({
            action: action.name,
            method: '-',
            path: '-',
            status: 0,
            ok: false,
            ms: 0,
            traceId: null,
            body: { error: String(error) },
          });
        }
        await sleep(randInt(runtime.state.rng, opts.thinkMin, opts.thinkMax));
      }
    }),
  );

  const elapsedSec = (Date.now() - startedAt) / 1000;
  const report = serialize(stats, runtimes, elapsedSec);
  const failures = loginResults.length - loggedIn.length;

  if (opts.reportPath) {
    await mkdir(dirname(opts.reportPath), { recursive: true });
    await writeFile(opts.reportPath, JSON.stringify(report));
  }

  if (opts.shards > 1) {
    console.log(
      `    shard ${opts.shardIndex}: ${loggedIn.length}/${chosen.length} logged in (+${failures} failed), ${report.total} requests, ${(report.total / elapsedSec).toFixed(1)} req/s`,
    );
  } else {
    printReport(merge([report]), opts.durationSec);
  }
  return report;
}

function merge(reports: ShardReport[]): ShardReport {
  const merged: ShardReport = {
    bots: 0,
    requests: 0,
    elapsedSec: Math.max(...reports.map((r) => r.elapsedSec), 1),
    total: 0,
    errors: 0,
    networkErrors: 0,
    withTraceId: 0,
    statuses: [],
    perAction: [],
    latencies: [],
    failingTraces: [],
  };
  const statuses = new Map<number, number>();
  const perAction = new Map<string, { count: number; ok: number; err: number; totalMs: number }>();

  for (const report of reports) {
    merged.bots += report.bots;
    merged.requests += report.requests;
    merged.total += report.total;
    merged.errors += report.errors;
    merged.networkErrors += report.networkErrors;
    merged.withTraceId += report.withTraceId;
    merged.latencies.push(...report.latencies);
    for (const trace of report.failingTraces) {
      if (merged.failingTraces.length < 25) merged.failingTraces.push(trace);
    }
    for (const [status, count] of report.statuses)
      statuses.set(status, (statuses.get(status) ?? 0) + count);
    for (const [name, bucket] of report.perAction) {
      const acc = perAction.get(name) ?? { count: 0, ok: 0, err: 0, totalMs: 0 };
      acc.count += bucket.count;
      acc.ok += bucket.ok;
      acc.err += bucket.err;
      acc.totalMs += bucket.totalMs;
      perAction.set(name, acc);
    }
  }
  merged.statuses = [...statuses.entries()];
  merged.perAction = [...perAction.entries()];
  return merged;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function printReport(report: ShardReport, durationSec: number): void {
  console.log('\n  ── Results ────────────────────────────────────────────────');
  console.log(`    wall time   : ${report.elapsedSec.toFixed(1)}s (target ${durationSec}s)`);
  console.log(`    bots        : ${report.bots} concurrent`);
  console.log(
    `    requests    : ${report.total} (${(report.total / report.elapsedSec).toFixed(1)} req/s)`,
  );
  console.log(
    `    errors      : ${report.errors} (${((report.errors / Math.max(1, report.total)) * 100).toFixed(1)}%)`,
  );
  console.log(`    network errs: ${report.networkErrors}`);
  console.log(`    latency p50 : ${percentile(report.latencies, 50).toFixed(0)}ms`);
  console.log(`    latency p95 : ${percentile(report.latencies, 95).toFixed(0)}ms`);
  console.log(`    latency p99 : ${percentile(report.latencies, 99).toFixed(0)}ms`);
  console.log(
    `    trace ids   : ${report.withTraceId}/${report.total} responses carried x-trace-id`,
  );

  console.log('\n  Status codes');
  for (const [status, count] of [...report.statuses].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${(status === 0 ? 'network' : String(status)).padEnd(8)} ${count}`);
  }

  console.log('\n  Actions (by volume)');
  for (const [name, bucket] of [...report.perAction].sort((a, b) => b[1].count - a[1].count)) {
    const avg = (bucket.totalMs / bucket.count).toFixed(0);
    console.log(
      `    ${name.padEnd(26)} ${String(bucket.count).padStart(7)}  avg ${avg.padStart(5)}ms  err ${bucket.err}`,
    );
  }

  if (report.failingTraces.length > 0) {
    console.log('\n  Recent failing trace ids (paste into Grafana → Explore → Tempo):');
    for (const trace of report.failingTraces.slice(0, 10)) {
      console.log(`    ${trace.traceId}  ${String(trace.status).padStart(3)}  ${trace.action}`);
    }
  }
  console.log('');
}

async function runParentMode(
  config: ReturnType<typeof resolveConfig>,
  opts: RunOptions,
): Promise<void> {
  const reportsDir = `${config.outDir}/reports`;
  await mkdir(reportsDir, { recursive: true });

  // Distribute exactly `users` across shards (remainder over the first shards).
  const base = Math.floor(opts.users / opts.shards);
  const remainder = opts.users % opts.shards;
  let offset = 0;

  console.log(`  Forking ${opts.shards} shard processes…`);
  const procs = Array.from({ length: opts.shards }, (_, index) => {
    const count = base + (index < remainder ? 1 : 0);
    const shardOffset = offset;
    offset += count;
    const reportPath = `${reportsDir}/shard-${index}.json`;
    const args = [
      'bun',
      import.meta.path,
      '--users',
      String(count),
      '--total-users',
      String(opts.users),
      '--shard-offset',
      String(shardOffset),
      '--shard-index',
      String(index),
      '--shards',
      String(opts.shards),
      '--duration',
      String(opts.durationSec),
      '--student-bots',
      String(opts.studentShare),
      '--think-min',
      String(opts.thinkMin),
      '--think-max',
      String(opts.thinkMax),
      '--login-concurrency',
      String(opts.loginConcurrency),
      '--seed',
      String(opts.seed),
      '--report',
      reportPath,
      '--accounts',
      config.accountsFile,
      '--app-url',
      config.appUrl,
    ];
    return {
      reportPath,
      proc: Bun.spawn({ cmd: args, stdout: 'inherit', stderr: 'inherit', env: process.env }),
    };
  });

  const onSigint = () => {
    for (const { proc } of procs) proc.kill();
  };
  process.on('SIGINT', onSigint);
  await Promise.all(procs.map(({ proc }) => proc.exited));
  process.off('SIGINT', onSigint);

  const reports: ShardReport[] = [];
  for (const { reportPath } of procs) {
    try {
      reports.push(JSON.parse(await readFile(reportPath, 'utf8')) as ShardReport);
    } catch {
      console.error(`  ! missing shard report ${reportPath}`);
    }
  }
  if (reports.length === 0) {
    console.error('  No shard reports produced.');
    process.exit(1);
  }
  printReport(merge(reports), opts.durationSec);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const config = resolveConfig({
    accountsFile: argStr(args, 'accounts', resolveConfig().accountsFile),
    appUrl: argStr(args, 'app-url', resolveConfig().appUrl),
  });

  if (argBool(args, 'help')) {
    console.log(`StudiQ load-test traffic generator

  --users <n>             concurrent bots (default 50)
  --duration <seconds>    how long to drive traffic (default 300)
  --shards <n>            OS processes / cores to spread bots across (default 1)
  --student-bots <0-1>    share of bots that are students (default 0.85)
  --think-min <ms>        minimum think time between actions (default 200)
  --think-max <ms>        maximum think time between actions (default 1500)
  --login-concurrency <n> parallel logins per shard (default 5)
  --seed <n>              RNG seed for reproducibility (default 42)
  --accounts <file>       account pool (default ${config.accountsFile})
  --app-url <url>         app base URL (default ${config.appUrl})
  --report <file>         internal: write a JSON shard report
  --shard-index <n>       internal: shard offset
  --help                  show this help

  Tip: pair --shards with the number of CPU cores, e.g. --shards 16.`);
    return;
  }

  const opts: RunOptions = {
    users: Math.max(1, argNum(args, 'users', 50)),
    totalUsers: Math.max(1, argNum(args, 'total-users', argNum(args, 'users', 50))),
    shardOffset: Math.max(0, argNum(args, 'shard-offset', 0)),
    durationSec: Math.max(1, argNum(args, 'duration', 300)),
    studentShare: Math.min(1, Math.max(0, argNum(args, 'student-bots', 0.85))),
    thinkMin: Math.max(0, argNum(args, 'think-min', 200)),
    thinkMax: Math.max(argNum(args, 'think-min', 200), argNum(args, 'think-max', 1500)),
    loginConcurrency: Math.max(1, argNum(args, 'login-concurrency', 5)),
    seed: argNum(args, 'seed', 42),
    shards: Math.max(1, argNum(args, 'shards', 1)),
    shardIndex: Math.max(0, argNum(args, 'shard-index', 0)),
    reportPath: typeof args.get('report') === 'string' ? String(args.get('report')) : undefined,
  };

  const pool = await loadPool(config.accountsFile);

  if (opts.shards > 1 && args.get('shard-index') === undefined) {
    console.log(`\n  StudiQ load test (${opts.shards} shards)`);
    console.log(`    app    : ${config.appUrl}`);
    console.log(`    bots   : ${opts.users} concurrent, spread over ${opts.shards} processes`);
    console.log(`    duration: ${opts.durationSec}s\n`);
    await runParentMode(config, opts);
    return;
  }

  console.log(`\n  StudiQ load test (shard ${opts.shardIndex}/${opts.shards})`);
  console.log(`    app    : ${config.appUrl}`);
  console.log(`    bots   : ${opts.users} concurrent (think ${opts.thinkMin}-${opts.thinkMax}ms)`);
  console.log(`    duration: ${opts.durationSec}s\n`);
  await runShard(config, pool, opts);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
