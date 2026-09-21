# Prometheus + Grafana Metrics Monitoring

**Date:** 2026-09-21
**Status:** Proposal

---

## Problem

We have OpenTelemetry **traces** flowing to Jaeger, but zero **metrics**. There's no
way to answer basic operational questions:

- How many requests per second is the API handling?
- What's the p95/p99 latency for `POST /api/v1/flashcards/batch/create`?
- What's the current error rate? Is it trending up?
- How many AI chat sessions are active right now?
- Which controller is the slowest?

Jaeger is great for inspecting individual traces but terrible at aggregate
"how are we doing right now?" questions. We need a time-series metrics layer
and live dashboards for both dev and prod.

## Current State

```
┌─────────────────────┐
│  StudiQ (Next.js)   │
│  instrumentation.ts │
│                     │
│  OTLP traces ───────┼──→ :4318 ──→ Jaeger all-in-one
└─────────────────────┘              (:16686 UI)

Custom agent traces → SQLite .dev/traces.db (dev only)
No metrics. No dashboards. No alerting.
```

OTel SDK is already wired up in `apps/web/src/instrumentation.ts`. Custom
spans exist in `with-auth.ts` (request-level) and `observability.ts`
(service-level via `wrapService`). The OTLP exporter already points at
localhost:4318.

## Architecture

### OTel Collector as the single intake

Replace the direct app→Jaeger path with an **OTel Collector** that fans out
to both Jaeger (traces) and Prometheus (metrics). The app doesn't care where
telemetry goes — it just sends OTLP to one endpoint.

```
┌──────────────────────┐
│  StudiQ (Next.js)    │
│                      │
│  Traces   ──────┐    │
│  Metrics  ──────┼────┼──→ OTLP/HTTP :4318
└──────────────────┼───┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  OTel Collector (otelcol contrib)        │
│                                          │
│  Receivers:  otlp (HTTP :4318)          │
│  Processors: batch, memory_limiter       │
│  Exporters:                             │
│    traces  → Jaeger (OTLP gRPC)         │
│    metrics → Prometheus exporter (:8889) │
└──────────────────────────────────────────┘
         │                       │
         ▼                       ▼
┌────────────────┐   ┌──────────────────────┐
│  Jaeger        │   │  Prometheus           │
│  :16686 (UI)   │   │  :9090                │
│  traces only   │   │  scrapes :8889        │
└────────────────┘   └──────────┬───────────┘
                                │
                                ▼
                      ┌──────────────────────┐
                      │  Grafana              │
                      │  :3001                │
                      │  - Metrics dashboards │
                      │  - Trace-to-metric    │
                      │    correlation        │
                      │  - Alert rules        │
                      └──────────────────────┘
```

### Why the Collector

- **Single OTLP endpoint** for the app — no separate trace vs. metric exporter config to wrangle
- **Batching and memory limiting** before data hits backends
- **Fan-out** — add backends (Loki, Datadog, etc.) later without touching app code
- **Standard production pattern** — if we ever move to K8s or Grafana Cloud, the Collector config stays the same

## Changes

### 1. New npm packages

```bash
bun add @opentelemetry/sdk-metrics @opentelemetry/exporter-metrics-otlp-http
```

Two packages. Both are official OTel JS SDK packages that match the versions
we already use (`@opentelemetry/sdk-node` ^0.220.0).

### 2. Update `apps/web/src/instrumentation.ts`

Add a `PeriodicExportingMetricReader` to the existing `NodeSDK` config:

```ts
const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'studiq',
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV ?? 'development',
  }),
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis: 15_000,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});
```

The `OTLPMetricExporter` sends to the same OTLP endpoint as traces
(`OTEL_EXPORTER_OTLP_ENDPOINT`, default `localhost:4318`). No new env vars
needed.

### 3. Custom metrics in `packages/server/src/lib/observability.ts`

Add a shared `Meter` and reusable instruments alongside the existing tracing:

```ts
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('studiq');

export const httpRequestDuration = meter.createHistogram('http.server.duration', {
  unit: 'ms',
  description: 'HTTP request duration',
});

export const httpRequestTotal = meter.createCounter('http.server.request.total', {
  description: 'Total HTTP requests by method, route, status',
});

export const activeRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Currently active inbound requests',
});
```

These use the same `@opentelemetry/api` import already in the file — no new
paradigm, just counter/histogram calls alongside the existing span calls.

### 4. Wire metrics into request lifecycle

**`packages/server/src/lib/with-auth.ts`** — record per-request metrics:

```ts
// At the start of the handler:
activeRequests.add(1, { 'http.method': req.method });
const t0 = performance.now();

// In the finally block:
const duration = performance.now() - t0;
httpRequestDuration.record(duration, {
  'http.method': req.method,
  'http.status_code': res.status,
});
httpRequestTotal.add(1, {
  'http.method': req.method,
  'http.status_code': res.status,
});
activeRequests.add(-1, { 'http.method': req.method });
```

**`packages/server/src/lib/observability.ts`** — optionally record service-level
durations in `withSupervision` for controller method breakdowns:

```ts
// In the finally block of withSupervision:
controllerMethodDuration.record(duration, {
  'service.name': meta.service,
  'code.function': meta.method,
});
```

### 5. Custom application metrics (optional, phased)

Add domain-specific metrics as the need arises:

| Metric | Type | Labels | Purpose |
|--------|------|--------|---------|
| `studiq.ai.chat.duration` | Histogram | `model`, `tool_name` | AI response latency |
| `studiq.ai.chat.tokens` | Counter | `model`, `direction` (prompt/completion) | Token usage tracking |
| `studiq.supabase.query.duration` | Histogram | `table`, `operation` | DB query latency |
| `studiq.auth.login.total` | Counter | `method`, `success` | Auth event tracking |
| `studiq.flashcards.created.total` | Counter | `account_type` | Usage by role |
| `studiq.active_users` | Gauge | — | Concurrent active sessions |

These can be added incrementally — no need to instrument everything at once.

### 6. Docker Compose expansion

Expand `docker-compose.yml` to run the full local stack:

```yaml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.112.0
    command: ["--config", "/etc/otelcol/config.yml"]
    volumes:
      - ./otel-collector-config.yml:/etc/otelcol/config.yml
    ports:
      - "4317:4317"
      - "4318:4318"
      - "8888:8888"

  jaeger:
    image: jaegertracing/all-in-one:1.60
    ports:
      - "16686:16686"
    depends_on:
      - otel-collector

  prometheus:
    image: prom/prometheus:v2.54.0
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    depends_on:
      - otel-collector

  grafana:
    image: grafana/grafana:11.2.0
    ports:
      - "3001:3000"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
    depends_on:
      - prometheus

volumes:
  prometheus_data:
  grafana_data:
```

**Breaking change:** Port 4318 moves from Jaeger directly to the Collector.
Update `OTEL_EXPORTER_OTLP_ENDPOINT` if pointing at a non-localhost collector
(e.g., `http://otel-collector:4318` in Docker networks).

### 7. OTel Collector config (`otel-collector-config.yml`)

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 1s
    limit_mib: 512

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true

  prometheus:
    endpoint: 0.0.0.0:8889
    namespace: studiq

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheus]
```

### 8. Prometheus scrape config (`prometheus.yml`)

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "studiq"
    static_configs:
      - targets: ["otel-collector:8889"]

  - job_name: "otel-collector"
    static_configs:
      - targets: ["otel-collector:8888"]
```

### 9. Grafana provisioning

Auto-provision the Prometheus datasource and import the standard OpenTelemetry
dashboard:

```
grafana/
  provisioning/
    datasources/
      prometheus.yml    # → http://prometheus:9090
    dashboards/
      dashboards.yml    # → load from /var/lib/grafana/dashboards
      otel-dashboard.json  # community dashboard for OTel metrics
```

Grafana community has ready-made dashboards for OpenTelemetry metrics
(`15757` — "OpenTelemetry Metrics" by Grafana Labs). Import via dashboard
provisioning or UI.

### 10. Node.js runtime metrics

`getNodeAutoInstrumentations()` already includes
`@opentelemetry/instrumentation-runtime-node` which emits:
- `process.runtime.nodejs.memory.heap.total`
- `process.runtime.nodejs.memory.heap.used`
- `process.runtime.nodejs.memory.rss`
- `process.runtime.nodejs.event_loop.lag`
- `process.runtime.nodejs.gc.duration`

These appear automatically once the `MetricReader` is configured — no extra
work needed.

## Dev vs. Prod

| | Dev | Prod |
|--|-----|------|
| **Collector** | Docker Compose (local) | Deploy separately (Docker/K8s) or use Grafana Cloud OTLP endpoint |
| **Prometheus** | Docker Compose (local) | Managed (Grafana Cloud, AWS Managed Prometheus) or self-hosted |
| **Grafana** | Docker Compose at :3001 | Managed or self-hosted |
| **Jaeger** | Docker Compose at :16686 | Same pattern, or Jaeger on Grafana Cloud |
| **OTEL_SDK_DISABLED** | Can disable to skip overhead | Always enabled |
| **Metric granularity** | Full (local is free) | Full if self-hosted; may sample if using paid cloud tier |
| **Alerting** | Not needed | Prometheus Alertmanager or Grafana alerts |

### Production path: Grafana Cloud (simplest)

If we don't want to self-host the stack in prod, **Grafana Cloud** offers:
- OTLP ingestion endpoint (app sends directly — no Collector needed)
- Prometheus, Jaeger, Loki, Tempo, Mimir included
- Free tier: 50 MB logs, 50 GB traces, 10k metrics series/mo
- No infra to maintain

The OTel Collector config stays identical — only the endpoint URL changes.

## What This Unlocks

### Live dev monitoring

`docker compose up` → open Grafana at `:3001` → see real-time request rate,
latency, error rate while developing. Catches performance regressions before
they ship.

### Production observability

- **Dashboards**: Request rate, latency percentiles, error rate, AI usage,
  active users — all visible at a glance
- **Alerting**: PagerDuty/Slack alerts when error rate spikes, latency
  degrades, or service goes down
- **Correlation**: Click a latency spike in Grafana → jump to the specific
  Jaeger traces that caused it
- **Capacity planning**: Historical metrics data for scaling decisions

### Debugging workflow

1. Grafana dashboard shows p99 latency spike on `/api/v1/ai/chat`
2. Click through to the trace view (Grafana Tempo or Jaeger)
3. Inspect individual slow traces — see which span (Supabase query? LLM
   call? auth middleware?) caused the delay
4. Fix the issue, watch the metric recover on the dashboard

## Open Questions

1. **Prometheus remote write vs. scrape?** The OTel Collector can expose a
   `/metrics` endpoint for Prometheus to scrape (simple, pull-based), or push
   via remote write. Scrape is fine for now; remote write if we hit scale
   limits.

2. **Metric naming convention?** The OTel semantic conventions recommend
   `http.server.duration` for HTTP metrics. We should follow
   [OTel HTTP semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/)
   to stay compatible with community dashboards.

3. **Custom metric cardinality?** Labels like `user_id` or `trace_id` must
   NOT be used as metric labels (high cardinality = TSDB explosion). Use
   `http.method`, `http.route`, `http.status_code`, `account_type` — bounded
   label sets only.
