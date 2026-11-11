/**
 * The machine-wide observability stack's host contract. Keep the host ports in
 * the 7000s: the env tool leases app ports from the 3000s, so a fixed Grafana
 * or Loki port in that range would collide with a normal checkout.
 *
 * Container-internal ports stay at their upstream defaults (Tempo 3200, Loki
 * 3100, Prometheus 9090, OTLP 4317/4318); only the host mappings move.
 */
export const OBSERVABILITY_PROJECT = 'studiq-observability';

const OBSERVABILITY_HOST = 'localhost';
const OBSERVABILITY_PORTS = {
  grafana: 7001,
  prometheus: 7090,
  loki: 7100,
  tempo: 7200,
  otlpGrpc: 7317,
  otlpHttp: 7318,
} as const;

export const OBSERVABILITY_URLS = {
  grafana: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.grafana}`,
  grafanaHealth: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.grafana}/api/health`,
  prometheus: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.prometheus}`,
  prometheusReady: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.prometheus}/-/ready`,
  loki: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.loki}`,
  lokiReady: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.loki}/ready`,
  tempo: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.tempo}`,
  tempoReady: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.tempo}/ready`,
  otlp: `http://${OBSERVABILITY_HOST}:${OBSERVABILITY_PORTS.otlpHttp}`,
} as const;

export const OTEL_ENDPOINT = OBSERVABILITY_URLS.otlp;
