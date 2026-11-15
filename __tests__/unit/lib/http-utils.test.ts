import { toNoStoreNextResponse } from '@studiq/server/lib/http-utils';
import { describe, expect, it } from 'vitest';

describe('toNoStoreNextResponse', () => {
  it('marks the response private and uncacheable', async () => {
    const response = toNoStoreNextResponse({
      success: true,
      statusCode: 200,
      data: { invoiceUrl: 'https://billing.example.com/invoice/1' },
    });

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { invoiceUrl: 'https://billing.example.com/invoice/1' },
    });
  });

  it('keeps the error code header on a failure body', () => {
    const response = toNoStoreNextResponse({ success: false, statusCode: 404, error: 'NOT_FOUND' });

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('x-error-code')).toBe('NOT_FOUND');
  });
});
