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
 */
const logger = logs.getLogger('studiq');

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
  logger.emit({
    severityNumber,
    severityText,
    body: message,
    attributes: toAttributes(attributes),
  });
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
