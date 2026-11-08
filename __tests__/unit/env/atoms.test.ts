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
  reconcile: boolean;
}

interface ParsedCommand {
  command: string;
  json: boolean;
  ensure: EnsureOptions | null;
  down: { all: boolean } | null;
  build: { force: boolean } | null;
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
      reconcile: false,
    });
  });

  it('makes profile web build and serve, and --prod imply both', () => {
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
      '--reconcile',
      '--runtime',
      'docker',
      '--stack',
      'phase2-test',
      '--app-port',
      '3123',
      '--wait',
      '45',
      '--yes',
      '--quiet',
    ]);
    expect(parsed.ensure).toMatchObject({
      capabilityAtoms: ['mail', 'studio'],
      reconcile: true,
      runtime: 'docker',
      stack: 'phase2-test',
      appPort: 3123,
      waitSeconds: 45,
    });
    expect(parsed.yes).toBe(true);
    expect(parsed.quiet).toBe(true);
  });

  it('rejects conflicting, unsupported and phase-3/4 atoms', () => {
    throwsUsage(['ensure', '--profile', 'api', '--seed', '--reseed'], /conflicts/);
    throwsUsage(['ensure', '--profile', 'api', '--quiet', '--verbose'], /cannot be combined/);
    throwsUsage(['ensure', '--profile', 'api', '--runtime', 'podman'], /podman/);
    throwsUsage(['ensure', '--profile', 'api', '--runtime', 'auto'], /auto/);
    throwsUsage(['ensure', '--profile', 'api', '--port-block', '3'], /phase 4/);
    throwsUsage(['ensure', '--profile', 'api', '--admin'], /phase 3/);
    throwsUsage(['ensure', '--profile', 'db'], /phase 3/);
    throwsUsage(['ensure', '--profile', 'nope'], /unknown profile/);
    throwsUsage(['ensure', '--json'], /--profile/);
    throwsUsage(['ensure', '--profile', 'api', '--build'], /does not build or serve/);
    throwsUsage(['ensure', '--profile', 'api', '--prod'], /does not build or serve/);
    throwsUsage(['ensure', '--profile', 'api', '--app-port', '0'], /out of range/);
    throwsUsage(['ensure', '--profile', 'api', '--wait', '0'], /1-3600|range/);
    throwsUsage(['ensure', '--profile', 'api', '--stack', 'bad name'], /valid stack name/);
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
      build: { force: true },
      json: true,
    });
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
