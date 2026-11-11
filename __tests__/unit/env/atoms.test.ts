import { describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface EnsureOptions {
  profile: string;
  capabilityAtoms: string[];
  seed: string;
  build: boolean;
  serve: boolean;
  forceBuild: boolean;
  runtime: string | null;
  stack: string | null;
  appPort: number | null;
  waitSeconds: number | null;
}

interface ParsedCommand {
  command: string;
  json: boolean;
  ensure: EnsureOptions | null;
  down: { all: boolean; stack: string | null } | null;
  build: { force: boolean; stack: string | null } | null;
  serve: { stack: string | null } | null;
  dev: {
    capabilityAtoms: string[];
    runtime: string | null;
    stack: string | null;
    waitSeconds: number | null;
  } | null;
  resetDb: { stack: string | null } | null;
  logs: { follow: boolean; stack: string | null } | null;
  setup: { force: boolean; vault: boolean } | null;
  verify: { full: boolean } | null;
  passthrough: string[];
  yes: boolean;
  quiet: boolean;
  verbose: boolean;
}

interface AtomsModule {
  parseCommand(argv: string[]): ParsedCommand;
  UsageError: new (message: string) => Error & { exitCode: number };
  USAGE: string;
}

const atoms = await loadEnvModule<AtomsModule>('atoms.ts');

function throwsUsage(argv: string[], pattern: RegExp): void {
  try {
    atoms.parseCommand(argv);
    throw new Error(`expected usage failure for ${argv.join(' ')}`);
  } catch (error) {
    expect(error).toBeInstanceOf(atoms.UsageError);
    if (typeof error !== 'object' || error === null) {
      throw new Error('expected an object error', { cause: error });
    }
    expect(Reflect.get(error, 'exitCode')).toBe(2);
    expect(error instanceof Error ? error.message : 'non-error').toMatch(pattern);
  }
}

describe('env atom grammar', () => {
  it('parses an api ensure with the documented defaults', () => {
    const parsed = atoms.parseCommand(['ensure', '--profile', 'api', '--json']);
    expect(parsed.command).toBe('ensure');
    expect(parsed.json).toBe(true);
    expect(parsed.ensure).toMatchObject({
      profile: 'api',
      capabilityAtoms: [],
      seed: 'default',
      build: false,
      serve: false,
      forceBuild: false,
      runtime: null,
      stack: null,
      appPort: null,
      waitSeconds: null,
    });
  });

  it('makes profile web build and serve', () => {
    expect(atoms.parseCommand(['ensure', '--profile', 'web']).ensure).toMatchObject({
      build: true,
      serve: true,
    });
    expect(atoms.parseCommand(['ensure', '--profile=web']).ensure).toMatchObject({
      profile: 'web',
      build: true,
      serve: true,
    });
  });

  it('rejects --web without --prod (the tool never runs next dev)', () => {
    throwsUsage(['ensure', '--profile', 'api', '--web'], /--web.*--prod/);
  });

  it('bounds --wait to a safe integer range', () => {
    expect(
      atoms.parseCommand(['ensure', '--profile', 'api', '--wait', '3600']).ensure,
    ).toMatchObject({ waitSeconds: 3600 });
    throwsUsage(['ensure', '--profile', 'api', '--wait', '3601'], /1-3600|range/);
    throwsUsage(['ensure', '--profile', 'api', '--wait', '9'.repeat(310)], /1-3600|range|number/);
  });

  it('parses capability atoms and the remaining value flags', () => {
    const parsed = atoms.parseCommand([
      'ensure',
      '--profile',
      'api',
      '--mail',
      '--studio',
      '--runtime',
      'docker',
      '--stack',
      'phase2-test',
      '--app-port',
      '3123',
      '--wait',
      '45',
      '--yes',
    ]);
    expect(parsed.ensure).toMatchObject({
      capabilityAtoms: ['mail', 'studio'],
      runtime: 'docker',
      stack: 'phase2-test',
      appPort: 3123,
      waitSeconds: 45,
    });
    expect(parsed.yes).toBe(true);
  });

  it('parses the realtime and analytics capability atoms', () => {
    const parsed = atoms.parseCommand(['ensure', '--profile', 'api', '--realtime', '--analytics']);
    expect(parsed.ensure).toMatchObject({ capabilityAtoms: ['realtime', 'analytics'] });
  });

  it('parses the functions capability atom', () => {
    const parsed = atoms.parseCommand(['ensure', '--profile', 'api', '--functions']);
    expect(parsed.ensure).toMatchObject({ capabilityAtoms: ['functions'] });
  });

  it('rejects conflicting, unsupported and unknown atoms', () => {
    throwsUsage(['ensure', '--profile', 'api', '--seed', '--no-seed'], /conflicts/);
    throwsUsage(['ensure', '--profile', 'api', '--reconcile'], /unknown option/);
    throwsUsage(['ensure', '--profile', 'api', '--runtime', 'podman'], /not supported/);
    throwsUsage(['ensure', '--profile', 'api', '--runtime', 'auto'], /not allowed/);
    throwsUsage(['ensure', '--profile', 'api', '--port-block', '3'], /unknown option/);
    throwsUsage(['ensure', '--profile', 'api', '--admin'], /unknown option/);
    throwsUsage(['ensure', '--profile', 'admin'], /unknown profile/);
    throwsUsage(['ensure', '--profile', 'nope'], /unknown profile/);
    throwsUsage(['ensure', '--json'], /--profile/);
    throwsUsage(['ensure', '--profile', 'api', '--build'], /does not build or serve/);
    throwsUsage(['ensure', '--profile', 'api', '--prod'], /does not build or serve/);
    throwsUsage(['ensure', '--profile', 'api', '--app-port', '0'], /1-65535/);
    throwsUsage(['ensure', '--profile', 'api', '--wait', '0'], /1-3600|range/);
    throwsUsage(['ensure', '--profile', 'api', '--stack', 'bad name'], /valid stack name/);
    throwsUsage(['ensure', '--profile', 'db', '--studio'], /requires '--rest'/);
  });

  it('accepts the db/mail/full/qa/e2e profiles and the quiet/verbose flags', () => {
    for (const profile of ['db', 'mail', 'full', 'qa', 'e2e']) {
      const parsed = atoms.parseCommand(['ensure', '--profile', profile]);
      expect(parsed.ensure).toMatchObject({ profile });
    }
    const quiet = atoms.parseCommand(['ensure', '--profile', 'web', '--quiet', '--verbose']);
    expect(quiet).toMatchObject({ quiet: true, verbose: true });
    expect(atoms.parseCommand(['ensure', '--profile', 'db']).ensure).toMatchObject({
      build: false,
      serve: false,
    });
  });

  it('parses the phase-3 lifecycle commands', () => {
    expect(atoms.parseCommand(['serve', '--stack', 'named', '--json'])).toMatchObject({
      command: 'serve',
      serve: { stack: 'named' },
      json: true,
    });
    expect(atoms.parseCommand(['dev', '--mail', '--runtime', 'docker'])).toMatchObject({
      command: 'dev',
      dev: { capabilityAtoms: ['mail'], runtime: 'docker' },
    });
    throwsUsage(['dev', '--admin'], /deferred/);
    expect(atoms.parseCommand(['reset-db', '--yes'])).toMatchObject({
      command: 'reset-db',
      resetDb: { stack: null },
      yes: true,
    });
    expect(atoms.parseCommand(['logs', '--no-follow']).logs).toMatchObject({ follow: false });
    expect(atoms.parseCommand(['logs']).logs).toMatchObject({ follow: true });
    expect(atoms.parseCommand(['setup', '--vault', '--force']).setup).toMatchObject({
      vault: true,
      force: true,
    });
    throwsUsage(['setup', '--stack', 'named'], /unknown option/);
    expect(atoms.parseCommand(['verify', '--full', '--json'])).toMatchObject({
      verify: { full: true },
      json: true,
    });
    expect(atoms.parseCommand(['verify', '--verbose'])).toMatchObject({ verbose: true });
  });

  it('parses down and build flags and their usage errors', () => {
    expect(atoms.parseCommand(['down', '--all', '--yes', '--json'])).toMatchObject({
      command: 'down',
      down: { all: true, stack: null },
      yes: true,
      json: true,
    });
    expect(atoms.parseCommand(['down', '--stack', 'named', '--all', '--json']).down).toMatchObject({
      all: true,
      stack: 'named',
    });
    expect(atoms.parseCommand(['down', '--stack=named', '--json']).down).toMatchObject({
      all: false,
      stack: 'named',
    });
    expect(atoms.parseCommand(['build', '--force', '--json'])).toMatchObject({
      command: 'build',
      build: { force: true, stack: null },
      json: true,
    });
    expect(atoms.parseCommand(['build', '--stack', 'named']).build).toMatchObject({
      force: false,
      stack: 'named',
    });
    throwsUsage(['build', '--stack', 'bad name'], /valid stack name/);
    throwsUsage(['down', '--profile', 'api'], /unknown option/);
    throwsUsage(['build', '--all'], /unknown option/);
  });

  it('keeps the phase-1 read-only commands and supa passthrough', () => {
    expect(atoms.parseCommand(['status', '--json']).json).toBe(true);
    expect(atoms.parseCommand(['ports', '--json']).command).toBe('ports');
    throwsUsage(['ports', '--suggest'], /unknown option/);
    const supa = atoms.parseCommand(['supa', '--', 'stack', 'status']);
    expect(supa.passthrough).toEqual(['stack', 'status']);
  });
});
