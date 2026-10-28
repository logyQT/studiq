import { createHash } from 'node:crypto';

/** RFC 4122 v5 UUID (SHA-1) — deterministic ids for e2e fixtures. */
const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export function uuidv5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable short hash, used for emails and org names. */
export function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 10);
}

/** The identity of one test's fixture graph: file + full title + browser project. */
export function tenantKey(file: string, title: string, project: string): string {
  return `${file.split('/').pop()}::${title}::${project}`;
}
