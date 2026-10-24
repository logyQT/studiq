import type { Config } from './config';

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export class Logger {
  constructor(private level: Config['logLevel']) {}

  private emit(level: keyof typeof ORDER, tag: string, message: string): void {
    if (ORDER[level] < ORDER[this.level]) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${tag}] ${message}`;
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  }

  debug(tag: string, message: string): void {
    this.emit('debug', tag, message);
  }
  info(tag: string, message: string): void {
    this.emit('info', tag, message);
  }
  warn(tag: string, message: string): void {
    this.emit('warn', tag, message);
  }
  error(tag: string, message: string): void {
    this.emit('error', tag, message);
  }
}

/** Never let a token leak through an error message or stack. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}
