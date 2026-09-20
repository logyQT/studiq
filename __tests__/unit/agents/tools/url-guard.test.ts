import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

import { assertSafeExternalUrl } from '@studiq/server/agents/tools/generic/url-guard';

describe('assertSafeExternalUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid URLs', async () => {
    await expect(assertSafeExternalUrl('not a url')).rejects.toThrow('not a valid URL');
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects non-http(s) protocols', async () => {
    await expect(assertSafeExternalUrl('file:///etc/passwd')).rejects.toThrow(
      'unsupported protocol',
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects the literal hostname "localhost"', async () => {
    await expect(assertSafeExternalUrl('http://localhost:5432/')).rejects.toThrow(
      'not a permitted destination',
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects .local hostnames without a DNS lookup', async () => {
    await expect(assertSafeExternalUrl('http://printer.local/')).rejects.toThrow(
      'not a permitted destination',
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects a literal private IPv4 address (no DNS lookup needed)', async () => {
    await expect(assertSafeExternalUrl('http://10.0.0.5/')).rejects.toThrow(
      'private/internal address',
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects the cloud metadata endpoint 169.254.169.254', async () => {
    await expect(assertSafeExternalUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      'private/internal address',
    );
  });

  it('rejects loopback 127.0.0.1', async () => {
    await expect(assertSafeExternalUrl('http://127.0.0.1:54321/')).rejects.toThrow(
      'private/internal address',
    );
  });

  it('rejects IPv6 loopback ::1', async () => {
    await expect(assertSafeExternalUrl('http://[::1]/')).rejects.toThrow(
      'private/internal address',
    );
  });

  it('allows a literal public IPv4 address', async () => {
    await expect(assertSafeExternalUrl('http://93.184.216.34/')).resolves.toBeUndefined();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('resolves a hostname via DNS and allows it when the address is public', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertSafeExternalUrl('https://example.com/article')).resolves.toBeUndefined();
    expect(lookupMock).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
  });

  it('blocks DNS rebinding: a public-looking hostname that resolves to a private IP', async () => {
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(assertSafeExternalUrl('https://looks-safe.example.com/')).rejects.toThrow(
      'private/internal address',
    );
  });

  it('fails closed when DNS resolution errors', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertSafeExternalUrl('https://does-not-resolve.invalid/')).rejects.toThrow(
      'could not resolve',
    );
  });
});
