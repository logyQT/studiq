import { logs, SeverityNumber } from '@opentelemetry/api-logs';

/**
 * Minimal OpenTelemetry-backed logger.
 *
 * Records are emitted through the OTel Logs pipeline, so each one
 * automatically carries the `trace_id` of the active span. That is what lets
 * Grafana jump from a Tempo trace to its logs in Loki (and back).
 *
 * This is the **one deliberate exception** to the "no logger module" rule —
 * see AGENTS.md → Observability. Do not add a second logging abstraction.
 *
 * When the OTel logs pipeline is not running (OTEL_SDK_DISABLED=true, or before
 * instrumentation.ts registers the provider) the API logger is a silent no-op,
 * so we fall back to console so unhandled errors are never lost.
 */
const logger = logs.getLogger('studiq');

// Next.js bundles instrumentation.ts separately from route code, so a module
// local flag would exist as two copies. Use a process-global symbol instead.
const PIPELINE_ACTIVE = Symbol.for('studiq.logs.pipelineActive');

/**
 * Called by `apps/web/src/instrumentation.ts` once the OTel LoggerProvider is
 * registered. Until then (and whenever the SDK is disabled) messages also go to
 * the process console.
 */
export function markLogsPipelineActive(): void {
  (globalThis as Record<symbol, unknown>)[PIPELINE_ACTIVE] = true;
}

function pipelineReady(): boolean {
  return (
    (globalThis as Record<symbol, unknown>)[PIPELINE_ACTIVE] === true &&
    process.env.OTEL_SDK_DISABLED !== 'true'
  );
}

type LogAttributes = Record<string, string | number | boolean>;

/** OTel attributes only accept primitives / arrays / nested maps — flatten the rest. */
function toAttributes(attributes?: Record<string, unknown>): LogAttributes {
  const flattened: LogAttributes = {};
  if (!attributes) return flattened;

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      flattened[key] = value;
    } else if (value instanceof Error) {
      flattened[`${key}.name`] = value.name;
      flattened[`${key}.message`] = value.message;
      if (value.stack) flattened[`${key}.stack`] = value.stack;
    } else {
      flattened[key] = JSON.stringify(value);
    }
  }

  return flattened;
}

function emit(
  severityNumber: SeverityNumber,
  severityText: string,
  message: string,
  attributes?: Record<string, unknown>,
): void {
  const flattened = toAttributes(attributes);
  logger.emit({ severityNumber, severityText, body: message, attributes: flattened });

  if (!pipelineReady()) {
    const line =
      Object.keys(flattened).length > 0 ? `${message} ${JSON.stringify(flattened)}` : message;
    if (severityNumber >= SeverityNumber.ERROR) console.error(line);
    else if (severityNumber >= SeverityNumber.WARN) console.warn(line);
    else console.log(line);
  }
}

export function log(message: string, attributes?: Record<string, unknown>): void {
  emit(SeverityNumber.INFO, 'INFO', message, attributes);
}

export function warn(message: string, attributes?: Record<string, unknown>): void {
  emit(SeverityNumber.WARN, 'WARN', message, attributes);
}

export function error(message: string, attributes?: Record<string, unknown>): void {
  emit(SeverityNumber.ERROR, 'ERROR', message, attributes);
}
