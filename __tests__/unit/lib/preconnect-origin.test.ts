import { describe, expect, it } from 'vitest';
import { preconnectOrigin } from '@/lib/preconnect-origin';

describe('preconnectOrigin', () => {
  it('keeps a real remote origin and drops its path', () => {
    expect(preconnectOrigin('https://api.studiq.app')).toBe('https://api.studiq.app');
    expect(preconnectOrigin('https://proj.supabase.co/rest/v1')).toBe('https://proj.supabase.co');
  });

  it('emits nothing for a local stack, whatever the loopback spelling', () => {
    expect(preconnectOrigin('http://localhost:54321')).toBeUndefined();
    expect(preconnectOrigin('http://127.0.0.1:54321')).toBeUndefined();
    expect(preconnectOrigin('http://[::1]:54321')).toBeUndefined();
    expect(preconnectOrigin('http://0.0.0.0:54321')).toBeUndefined();
  });

  it('emits nothing for an empty or unparsable value instead of guessing', () => {
    expect(preconnectOrigin('')).toBeUndefined();
    expect(preconnectOrigin(undefined)).toBeUndefined();
    expect(preconnectOrigin('localhost:54321')).toBeUndefined();
    expect(preconnectOrigin('not a url')).toBeUndefined();
  });
});
