import { context, SpanStatusCode, trace } from '@opentelemetry/api';

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
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      const duration = performance.now() - t0;
      span.setAttribute('duration.ms', duration);
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
