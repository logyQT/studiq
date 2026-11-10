import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * One HTTP GET, returning the status code (or 0 when unreachable/timeout).
 *
 * Mirrors the legacy dev script's `curl -s -o /dev/null --max-time 2 -w '%{http_code}'`:
 * redirects are not followed, no cookies/proxy, and a healthy check is a 2xx.
 * No keep-alive agent is kept, so a read-only command exits immediately.
 */
export function probeHttp(url: string, timeoutMs = 2000): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      // Every settle path clears the deadline timer, so a probe can never keep
      // the process alive after it has resolved.
      if (deadline !== undefined) clearTimeout(deadline);
      resolve(code);
    };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      finish(0);
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      finish(0);
      return;
    }

    const request = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(parsed, { method: 'GET', timeout: timeoutMs, agent: false }, (res) => {
      const code = res.statusCode ?? 0;
      res.resume();
      res.on('end', () => finish(code >= 100 && code <= 599 ? code : 0));
      res.on('error', () => finish(0));
    });
    // `timeout` above is a socket *inactivity* timeout: a response that keeps
    // streaming data without ever ending resets it forever. This absolute
    // deadline bounds the whole request lifecycle.
    deadline = setTimeout(() => {
      req.destroy();
      finish(0);
    }, timeoutMs);
    req.on('timeout', () => {
      req.destroy();
      finish(0);
    });
    req.on('error', () => finish(0));
    req.end();
  });
}
