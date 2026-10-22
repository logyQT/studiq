export async function register() {
  if (process.env.OTEL_SDK_DISABLED === 'true') return;

  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
  const { OTLPLogExporter } = await import('@opentelemetry/exporter-logs-otlp-http');
  const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
  const { BatchLogRecordProcessor } = await import('@opentelemetry/sdk-logs');
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME, ATTR_DEPLOYMENT_ENVIRONMENT_NAME } = await import(
    '@opentelemetry/semantic-conventions'
  );

  // Traces, metrics and logs all ship to the OTel Collector via OTLP/HTTP.
  // The exporters read OTEL_EXPORTER_OTLP_ENDPOINT (default http://localhost:4318).
  // OTEL_SERVICE_NAME lets parallel QA agents identify themselves
  // (e.g. studiq-MGR-MEM-03) so their telemetry stays separable.
  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'studiq';
  const environment =
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: environment,
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15_000,
    }),
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    instrumentations: [getNodeAutoInstrumentations()],
  });

  await sdk.start();

  // Flip the logger off its console fallback now that OTLP shipping is live.
  const { markLogsPipelineActive } = await import('@studiq/server/lib/log');
  markLogsPipelineActive();
}
