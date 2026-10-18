import { afterEach, describe, expect, it, vi } from 'vitest';

describe('log.ts console fallback', () => {
  const original = process.env.OTEL_SDK_DISABLED;
  const PIPELINE_ACTIVE = Symbol.for('studiq.logs.pipelineActive');

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as Record<symbol, unknown>)[PIPELINE_ACTIVE];
    if (original === undefined) delete process.env.OTEL_SDK_DISABLED;
    else process.env.OTEL_SDK_DISABLED = original;
  });

  it('falls back to console when the OTel logs pipeline is not active', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    vi.resetModules();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { error } = await import('@studiq/server/lib/log');
    error('boom', { 'error.code': 'INTERNAL_SERVER' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('boom');
  });

  it('stays quiet once the pipeline is active', async () => {
    delete process.env.OTEL_SDK_DISABLED;
    vi.resetModules();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { error, markLogsPipelineActive } = await import('@studiq/server/lib/log');
    markLogsPipelineActive();
    error('boom');

    expect(spy).not.toHaveBeenCalled();
  });
});
