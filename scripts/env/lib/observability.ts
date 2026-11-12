/**
 * The machine-wide observability stack's host contract. Keep the host ports in
 * the 7000s: the env tool leases app ports from the 3000s, so a fixed Grafana
 * or Loki port in that range would collide with a normal checkout.
 *
 * Container-internal ports stay at their upstream defaults (Tempo 3200, Loki
 * 3100, Prometheus 9090, OTLP 4317/4318, collector exporter 8889); only the
 * host mappings move.
 */
export const OBSERVABILITY_PROJECT = 'studiq-observability';

const OBSERVABILITY_HOST = 'localhost';

/**
 * The host port each service publishes to. `docker-compose.yml` carries the
 * matching `host:container` mapping, and the unit tests assert the two stay in
 * sync, so a port cannot move in one place only.
 *
 * @public Used by the env unit tests, which load this module by a computed URL.
 */
export const OBSERVABILITY_PORTS = {
  grafana: 7001,
  prometheus: 7090,
  loki: 7100,
  tempo: 7200,
  otlpGrpc: 7317,
  otlpHttp: 7318,
  prometheusExporter: 7889,
} as const;

export const OBSERVABILITY_URLS = {
  grafana: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.grafana}`,
  grafanaHealth: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.grafana}/api/health`,
  prometheusReady: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.prometheus}/-/ready`,
  lokiReady: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.loki}/ready`,
  tempoReady: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.tempo}/ready`,
  otlp: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.otlpHttp}`,
} as const;

export const OTEL_ENDPOINT = OBSERVABILITY_URLS.otlp;
