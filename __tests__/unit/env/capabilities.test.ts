import { describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';
import { startHttpServer, startTcpListener } from '#test/unit/env/support';

interface CapabilitiesModule {
  observedCapabilities(services: string[]): string[];
  probeCapabilities(
    capabilities: Iterable<string>,
    context: Record<string, unknown>,
  ): Promise<{ ok: boolean; failed: string[] }>;
}

const capabilities = await loadEnvModule<CapabilitiesModule>('lib/capabilities.ts');

const PORTS = {
  api: 0,
  db: 0,
  studio: 0,
  mail: 0,
  mailSmtp: 0,
  mailPop3: 0,
  realtime: 0,
  analytics: 0,
  edgeInspector: 0,
  pooler: 0,
  pgmeta: 0,
};

function context(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiUrl: 'http://127.0.0.1:1',
    dbPort: 0,
    mailUrl: null,
    studioUrl: null,
    ports: PORTS,
    ...overrides,
  };
}

describe('capability probes (spec §5.2)', () => {
  it('keeps only known running services in the observed set', () => {
    expect(
      capabilities.observedCapabilities(['database', 'rest', 'mail', 'unknown', 'database']),
    ).toEqual(['database', 'rest', 'mail']);
  });

  it('fails readiness when a requested service is unreachable', async () => {
    const result = await capabilities.probeCapabilities(['auth'], context());
    expect(result).toEqual({ ok: false, failed: ['auth'] });
  });

  it('probes Mailpit over its own URL', async () => {
    const mail = await startHttpServer(200);
    try {
      const result = await capabilities.probeCapabilities(['mail'], context({ mailUrl: mail.url }));
      expect(result).toEqual({ ok: true, failed: [] });
    } finally {
      await mail.close();
    }
  });

  it('treats a missing Mailpit URL as a failed probe', async () => {
    const result = await capabilities.probeCapabilities(['mail'], context({ mailUrl: null }));
    expect(result).toEqual({ ok: false, failed: ['mail'] });
  });

  it('accepts a reachable database port', async () => {
    const listener = await startTcpListener(0);
    try {
      const result = await capabilities.probeCapabilities(
        ['database'],
        context({ dbPort: listener.port }),
      );
      expect(result).toEqual({ ok: true, failed: [] });
    } finally {
      await listener.close();
    }
  });

  it('deduplicates requested capabilities', async () => {
    const result = await capabilities.probeCapabilities(['auth', 'auth'], context());
    expect(result.failed).toEqual(['auth']);
  });
});
