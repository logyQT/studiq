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
