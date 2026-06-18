import en from '../../src/i18n/messages/en.json';
import pl from '../../src/i18n/messages/pl.json';

export const t = (path: string) => {
  const getNested = (obj: Record<string, unknown>, keyPath: string): unknown =>
    keyPath
      .split('.')
      .reduce<unknown>((prev, curr) => (prev as Record<string, unknown>)?.[curr], obj);

  const enVal = getNested(en, path);
  const plVal = getNested(pl, path);

  if (!enVal || !plVal) {
    throw new Error(`Translation key "${path}" missing in en or pl json`);
  }

  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`${escape(enVal as string)}|${escape(plVal as string)}`, 'i');
};
