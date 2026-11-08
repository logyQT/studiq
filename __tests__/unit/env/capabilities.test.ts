import { describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface CapabilitiesModule {
  capabilityDecision(
    observed: Iterable<string>,
    requested: Iterable<string>,
    reconcile: boolean,
  ): { action: 'ready' | 'restart' | 'conflict'; missing: string[] };
  observedCapabilities(services: string[]): string[];
  capabilityConflictMessage(missing: string[]): string;
  probeCapabilities(
    capabilities: Iterable<string>,
    context: Record<string, unknown>,
  ): Promise<{ ok: boolean; failed: string[] }>;
}

const capabilities = await loadEnvModule<CapabilitiesModule>('lib/capabilities.ts');

const api = ['database', 'auth', 'storage', 'rest'];
const full = [...api, 'mail'];

describe('capability reconciliation (spec §5.2, §13 test 13)', () => {
  it('is ready for a narrower request against a running superset', () => {
    expect(capabilities.capabilityDecision(full, api, false)).toEqual({
      action: 'ready',
      missing: [],
    });
  });

  it('conflicts when adding a capability without --reconcile', () => {
    expect(capabilities.capabilityDecision(api, full, false)).toEqual({
      action: 'conflict',
      missing: ['mail'],
    });
  });

  it('restarts in place when --reconcile is set', () => {
    expect(capabilities.capabilityDecision(api, full, true)).toEqual({
      action: 'restart',
      missing: ['mail'],
    });
  });

  it('never treats removing capabilities as an action', () => {
    expect(capabilities.capabilityDecision(full, api, true)).toEqual({
      action: 'ready',
      missing: [],
    });
  });

  it('keeps only known running services in the observed set', () => {
    expect(
      capabilities.observedCapabilities(['database', 'rest', 'mail', 'unknown', 'database']),
    ).toEqual(['database', 'rest', 'mail']);
  });

  it('names the missing capability and the flag in the conflict message', () => {
    const message = capabilities.capabilityConflictMessage(['mail']);
    expect(message).toContain('mail');
    expect(message).toContain('--reconcile');
    expect(message).toContain('--yes');
  });

  it('fails readiness when a requested service is unreachable', async () => {
    const result = await capabilities.probeCapabilities(['auth'], {
      apiUrl: 'http://127.0.0.1:1',
      dbPort: 0,
      mailUrl: null,
      studioUrl: null,
      ports: {
        api: 0,
        db: 0,
        studio: 0,
        mail: 0,
        mailSmtp: 0,
        mailPop3: 0,
        analytics: 0,
        edgeInspector: 0,
        pooler: 0,
        pgmeta: 0,
      },
    });
    expect(result).toEqual({ ok: false, failed: ['auth'] });
  });
});
