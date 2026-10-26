import {
  ApiError,
  apiGet,
  apiPut,
  getFieldErrorCode,
  getFieldErrorCodes,
  isNetworkError,
} from '@/lib/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

const issueBody = {
  success: false,
  error: 'UNPROCESSABLE_ENTITY',
  issues: {
    errors: [],
    properties: {
      name: { errors: ['VALIDATION_NAME_INVALID_FORMAT'] },
    },
  },
};

function mockFetchResponse(body: unknown, status: number) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiPut', () => {
  it('throws an ApiError that keeps the app error code in message and preserves issues', async () => {
    mockFetchResponse(issueBody, 422);

    const error = await apiPut('/api/v1/auth/profile', { name: 'Anna123' }).catch((err) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(error.message).toBe('UNPROCESSABLE_ENTITY');
    expect(error.status).toBe(422);
    expect(error.issues).toEqual(issueBody.issues);
  });

  it('falls back to a method/url message when the body has no error code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 500 })));

    const error = await apiPut('/api/v1/auth/profile', { name: 'Anna Nowak' }).catch((err) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('PUT /api/v1/auth/profile failed');
    expect(error.issues).toBeUndefined();
  });

  it('returns the data payload on success', async () => {
    mockFetchResponse({ success: true, data: { id: 'user-1' } }, 200);

    await expect(apiPut('/api/v1/auth/profile', { name: 'Anna Nowa' })).resolves.toEqual({
      id: 'user-1',
    });
  });
});

describe('network failures (#190)', () => {
  it('turns a failed fetch into ApiError(NETWORK_ERROR) so callers can say the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await apiPut('/api/v1/flashcards/decks', { name: 'Deck' }).catch((err) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
    expect(isNetworkError(error)).toBe(true);
  });

  it('does not treat other failures as network errors', async () => {
    mockFetchResponse({ success: false, error: 'INTERNAL_SERVER' }, 500);

    const error = await apiGet('/api/v1/flashcards/decks').catch((err) => err);

    expect(isNetworkError(error)).toBe(false);
    expect(isNetworkError(new Error('NETWORK_ERROR'))).toBe(false);
  });

  it('rethrows errors that are not transport failures', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

    await expect(apiGet('/api/v1/flashcards/decks')).rejects.toBe(abort);
  });
});

describe('getFieldErrorCode', () => {
  it('returns the first validation code for a top-level field', async () => {
    mockFetchResponse(issueBody, 422);

    const error = await apiPut('/api/v1/auth/profile', { name: 'Anna123' }).catch((err) => err);

    expect(getFieldErrorCode(error, 'name')).toBe('VALIDATION_NAME_INVALID_FORMAT');
  });

  it('returns undefined for an unknown field', async () => {
    const error = new ApiError('UNPROCESSABLE_ENTITY', 422, issueBody.issues);

    expect(getFieldErrorCode(error, 'email')).toBeUndefined();
  });

  it('returns undefined when issues are absent', () => {
    expect(getFieldErrorCode(new ApiError('INTERNAL_SERVER', 500), 'name')).toBeUndefined();
  });

  it('returns undefined for non-ApiError values', () => {
    expect(getFieldErrorCode(new Error('UNPROCESSABLE_ENTITY'), 'name')).toBeUndefined();
    expect(getFieldErrorCode(undefined, 'name')).toBeUndefined();
  });
});

describe('getFieldErrorCodes', () => {
  const passwordIssues = {
    errors: [],
    properties: {
      password: {
        errors: [
          'VALIDATION_PASSWORD_TOO_SHORT',
          'VALIDATION_PASSWORD_MISSING_UPPERCASE',
          'VALIDATION_PASSWORD_MISSING_NUMBER',
        ],
      },
    },
  };

  it('returns every validation code for a field, in payload order', () => {
    const error = new ApiError('UNPROCESSABLE_ENTITY', 422, passwordIssues);

    expect(getFieldErrorCodes(error, 'password')).toEqual([
      'VALIDATION_PASSWORD_TOO_SHORT',
      'VALIDATION_PASSWORD_MISSING_UPPERCASE',
      'VALIDATION_PASSWORD_MISSING_NUMBER',
    ]);
  });

  it('removes duplicate codes', () => {
    const error = new ApiError('UNPROCESSABLE_ENTITY', 422, {
      errors: [],
      properties: {
        password: {
          errors: ['VALIDATION_PASSWORD_MISSING_NUMBER', 'VALIDATION_PASSWORD_MISSING_NUMBER'],
        },
      },
    });

    expect(getFieldErrorCodes(error, 'password')).toEqual(['VALIDATION_PASSWORD_MISSING_NUMBER']);
  });

  it('returns an empty array for an unknown field, missing issues or non-ApiError values', () => {
    expect(
      getFieldErrorCodes(new ApiError('UNPROCESSABLE_ENTITY', 422, passwordIssues), 'name'),
    ).toEqual([]);
    expect(getFieldErrorCodes(new ApiError('INTERNAL_SERVER', 500), 'password')).toEqual([]);
    expect(getFieldErrorCodes(new Error('UNPROCESSABLE_ENTITY'), 'password')).toEqual([]);
    expect(getFieldErrorCodes(undefined, 'password')).toEqual([]);
  });
});
