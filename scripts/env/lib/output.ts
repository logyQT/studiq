/**
 * stdout/stderr helpers.
 *
 * Machine output (`--json`) goes to stdout as a single line and nothing else;
 * human diagnostics go to stderr. Commands in phase 1 never print a value.
 */

export function writeLine(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function writeStderrLine(text = ''): void {
  process.stderr.write(`${text}\n`);
}

export function printJson(value: unknown): void {
  writeLine(JSON.stringify(value));
}

/**
 * Strip ANSI escape sequences from captured child output.
 *
 * `next build` colours its compiler errors, and a captured stream keeps the
 * escapes: `.dev/env.log` was unreadable and a terminal paste of it was worse.
 * Everything this tool re-prints from a child goes through here first.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- the escape byte is the point
  return text.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/**
 * Strip anything that looks like key material or a DB password from CLI
 * stderr before it reaches a user-visible error or `.dev/env.log`.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/g, 'postgresql://[redacted]@');
}
