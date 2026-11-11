/** A shared-mode TCP port from the environment; 0 when unset or invalid. */
export function envPort(value: string | undefined): number {
  const port = Number(value ?? '0');
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}
