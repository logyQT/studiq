import { execFile } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const SCENARIO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DECISION = /^dec_[A-Za-z0-9]+$/i;

function run(cmd: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const code = error ? Number((error as { code?: number | string }).code ?? 1) : 0;
        resolve({
          code: Number.isFinite(code) ? code : 1,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
  });
}

export class QaManager {
  constructor(
    private readonly script: string,
    private readonly cwd: string,
  ) {}

  async runRaw(args: string[], timeoutMs?: number): Promise<RunResult> {
    return run('python3', [this.script, ...args], this.cwd, timeoutMs);
  }

  private static assert(ok: boolean, what: string): void {
    if (!ok) throw new Error(`invalid ${what}`);
  }

  async status(): Promise<RunResult> {
    return this.runRaw(['status'], 60_000);
  }

  async free(): Promise<RunResult> {
    return this.runRaw(['free'], 60_000);
  }

  async dispatch(scenario: string, env?: number): Promise<RunResult> {
    QaManager.assert(SCENARIO.test(scenario), 'scenario id');
    if (env !== undefined)
      QaManager.assert(Number.isInteger(env) && env >= 1 && env <= 4, 'env slot');
    const args = ['dispatch', scenario];
    if (env !== undefined) args.push('--env', String(env));
    return this.runRaw(args, 180_000);
  }

  async queue(scenarios: string[]): Promise<RunResult> {
    for (const id of scenarios) QaManager.assert(SCENARIO.test(id), `scenario id (${id})`);
    return this.runRaw(['queue', ...scenarios], 180_000);
  }

  async report(env?: number): Promise<RunResult> {
    if (env !== undefined)
      QaManager.assert(Number.isInteger(env) && env >= 1 && env <= 4, 'env slot');
    const args = ['report'];
    if (env !== undefined) args.push('--env', String(env));
    return this.runRaw(args, 60_000);
  }

  private decisionArgs(sub: string, id?: string, extra: string[] = []): string[] {
    const args = ['decisions', sub];
    if (id !== undefined) {
      QaManager.assert(DECISION.test(id), 'decision id');
      args.push(id);
    }
    return [...args, ...extra];
  }

  async decisionsPending(): Promise<RunResult> {
    return this.runRaw(['decisions', 'pending'], 60_000);
  }

  async decisionsShow(id: string): Promise<RunResult> {
    return this.runRaw(this.decisionArgs('show', id), 60_000);
  }

  async decisionsFile(id: string): Promise<RunResult> {
    return this.runRaw(this.decisionArgs('file', id, ['--yes']), 180_000);
  }

  async decisionsSpawn(id: string): Promise<RunResult> {
    return this.runRaw(this.decisionArgs('spawn', id), 180_000);
  }

  async decisionsAnswer(id: string, action: 'skip' | 'file' | 'investigate'): Promise<RunResult> {
    return this.runRaw(this.decisionArgs('answer', id, [action]), 60_000);
  }
}
