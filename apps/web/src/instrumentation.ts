export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // A bad MAIL_DRIVER / SMTP setting must stop the server at boot (#604), not surface later as
    // invitations that silently never arrive. Runs before the telemetry opt-out below.
    const { getMailer } = await import('@studiq/server/lib/mailer');
    getMailer();

    // The same rule for payments (#662): a bad PAYMENT_DRIVER or missing
    // Stripe setting must crash at boot, not on the first checkout. Production
    // always runs Stripe; `mock` is rejected there with no override.
    const { getPaymentGateway } =
      await import('@studiq/server/lib/payment/payment-gateway.factory');
    const gateway = getPaymentGateway();
    // Readiness line for operators: provider + mode only, never key material.
    // Emitted after the log pipeline is active when telemetry is on.
    const logReady = async () => {
      const { log } = await import('@studiq/server/lib/log');
      log('payment.gateway_ready', { provider: gateway.driver, livemode: gateway.livemode });
    };

    if (process.env.OTEL_SDK_DISABLED === 'true') {
      await logReady();
      return;
    }

    await startTelemetry(logReady);
  }
}

async function startTelemetry(logReady: () => Promise<void>): Promise<void> {
  if (process.env.OTEL_SDK_DISABLED === 'true') return;

  // `register()` already validated the environment through
  // `getPaymentGateway()`, so resolving it here cannot throw.
  const { resolveAppEnv } = await import('@studiq/server/lib/app-env');
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
  const { OTLPLogExporter } = await import('@opentelemetry/exporter-logs-otlp-http');
  const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
  const { BatchLogRecordProcessor } = await import('@opentelemetry/sdk-logs');
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME, ATTR_DEPLOYMENT_ENVIRONMENT_NAME } =
    await import('@opentelemetry/semantic-conventions');

  // Traces, metrics and logs all ship to the OTel Collector via OTLP/HTTP.
  // The exporters read OTEL_EXPORTER_OTLP_ENDPOINT (default http://localhost:4318).
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'studiq',
      // APP_ENV is the deployment posture; NODE_ENV is 'production' in QA too.
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: resolveAppEnv(),
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 15_000,
      }),
    ],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  // Flip the logger off its console fallback now that OTLP shipping is live.
  const { markLogsPipelineActive } = await import('@studiq/server/lib/log');
  markLogsPipelineActive();

  await logReady();
}
