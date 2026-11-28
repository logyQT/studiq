import { logs, SeverityNumber } from '@opentelemetry/api';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { error, log, markLogsPipelineActive } from '@studiq/server/lib/log';
import { describe, expect, it } from 'vitest';

const PIPELINE_ACTIVE = Symbol.for('studiq.logs.pipelineActive');

describe('log.ts OTel export', () => {
  it('exports the exact record through the globally registered logger provider', async () => {
    // vitest.config.ts sets OTEL_SDK_DISABLED=true. Clear it so the records
    // reach the provider instead of only the console fallback.
    const sdkDisabled = process.env.OTEL_SDK_DISABLED;
    delete process.env.OTEL_SDK_DISABLED;

    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor({ exporter })],
    });
    // This is the call NodeSDK.start() makes. log.ts holds a logger from the
    // API proxy, so the test fails if the app imports the legacy api-logs.
    logs.setGlobalLoggerProvider(provider);

    try {
      markLogsPipelineActive();

      log('question.saved', { questionId: 'q1', count: 2 });
      error('question.save_failed', { code: 'DB', cause: new Error('boom') });
      await provider.forceFlush();

      // shutdown() empties the exporter's buffer, so read the records first.
      const records = [...exporter.getFinishedLogRecords()];
      expect(records.map((record) => record.body)).toEqual([
        'question.saved',
        'question.save_failed',
      ]);
      expect(records.map((record) => record.severityNumber)).toEqual([
        SeverityNumber.INFO,
        SeverityNumber.ERROR,
      ]);
      expect(records.map((record) => record.severityText)).toEqual(['INFO', 'ERROR']);
      expect(records.map((record) => record.instrumentationScope.name)).toEqual([
        'studiq',
        'studiq',
      ]);
      expect(records[0]?.attributes).toEqual({ questionId: 'q1', count: 2 });
      const failureAttributes = records[1]?.attributes;
      expect(failureAttributes).toEqual(
        expect.objectContaining({
          code: 'DB',
          'cause.name': 'Error',
          'cause.message': 'boom',
        }),
      );
      expect(typeof failureAttributes?.['cause.stack']).toBe('string');
    } finally {
      await provider.shutdown();
      logs.disable();
      delete (globalThis as Record<symbol, unknown>)[PIPELINE_ACTIVE];
      if (sdkDisabled === undefined) delete process.env.OTEL_SDK_DISABLED;
      else process.env.OTEL_SDK_DISABLED = sdkDisabled;
    }
  });
});
