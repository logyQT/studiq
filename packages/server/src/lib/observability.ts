import { context, metrics, SpanStatusCode, trace } from '@opentelemetry/api';

// ── Metrics ────────────────────────────────────────────────────────────────
// One shared meter for the whole server package. The OTel Collector's
// Prometheus exporter adds the `studiq` namespace, so these land in Prometheus
// as `studiq_http_server_duration_milliseconds`, `studiq_http_server_request_total`,
// `studiq_http_server_active_requests` and `studiq_controller_method_duration_milliseconds`.
const meter = metrics.getMeter('studiq');

/** Inbound HTTP request duration (ms), labelled by method + status code. */
export const httpRequestDuration = meter.createHistogram('http.server.duration', {
  unit: 'ms',
  description: 'Inbound HTTP request duration in milliseconds',
});

/** Total inbound HTTP requests, labelled by method + status code. */
export const httpRequestTotal = meter.createCounter('http.server.request.total', {
  description: 'Total inbound HTTP requests',
});

/** Currently in-flight inbound requests, labelled by method. */
export const activeRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Currently in-flight inbound HTTP requests',
});

/** Controller/service method duration (ms), labelled by service + method. */
export const controllerMethodDuration = meter.createHistogram('controller.method.duration', {
  unit: 'ms',
  description: 'Controller and service method duration in milliseconds',
});

function isServiceResultFailure(value: unknown): value is { success: false; error: string } {
  return (
    value !== null && typeof value === 'object' && 'success' in value && value.success === false
  );
}

interface SupervisionMeta {
  service: string;
  method: string;
  group?: string;
}

export function withSupervision<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  meta: SupervisionMeta,
): (...args: Args) => Promise<T> {
  const tracer = trace.getTracer(meta.service);

  return async (...args: Args): Promise<T> => {
    const spanName = `${meta.service}.${meta.method}`;
    const span = tracer.startSpan(spanName);

    span.setAttributes({
      'code.function': meta.method,
      'code.namespace': meta.service,
      ...(meta.group ? { 'service.group': meta.group } : {}),
    });

    const t0 = performance.now();

    try {
      const result = await context.with(trace.setSpan(context.active(), span), () => fn(...args));

      if (isServiceResultFailure(result)) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute('error.code', result.error);
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.recordException(error instanceof Error ? error : new Error(message));
      // Surface the application error code on the span so failures aren't bare
      // 500s in Tempo (e.g. AppError → `BAD_REQUEST`, DatabaseError → `23502`).
      if (error && typeof error === 'object' && 'code' in error) {
        span.setAttribute('error.code', String((error as { code: unknown }).code));
      }
      throw error;
    } finally {
      const duration = performance.now() - t0;
      span.setAttribute('duration.ms', duration);
      controllerMethodDuration.record(duration, {
        'service.name': meta.service,
        'code.function': meta.method,
      });
      span.end();
    }
  };
}

export function wrapService<T extends object>(
  service: T,
  serviceName: string,
  opts?: { group?: string },
): T {
  const cache = new Map<string, unknown>();

  return new Proxy(service, {
    get(target, prop) {
      const key = String(prop);
      if (key === 'constructor') return (target as Record<string, unknown>)[key];

      if (cache.has(key)) return cache.get(key);

      const value = (target as Record<string, unknown>)[key];
      if (typeof value === 'function') {
        const wrapped = withSupervision(
          value.bind(target) as (...args: unknown[]) => Promise<unknown>,
          { service: serviceName, method: key, group: opts?.group },
        );
        cache.set(key, wrapped);
        return wrapped;
      }

      return value;
    },
  });
}
