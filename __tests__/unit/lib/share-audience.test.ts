import { shareAudienceToAuthorize } from '@studiq/server/lib/authz';
import { describe, expect, it } from 'vitest';

describe('shareAudienceToAuthorize', () => {
  it('returns null when both sets are empty', () => {
    expect(shareAudienceToAuthorize([], [])).toBeNull();
  });

  it('returns null when the same groups arrive in another order', () => {
    expect(shareAudienceToAuthorize(['g-1', 'g-2'], ['g-2', 'g-1'])).toBeNull();
  });

  it('returns the union when a group is added', () => {
    expect(shareAudienceToAuthorize(['g-1'], ['g-1', 'g-2'])).toEqual(['g-1', 'g-2']);
  });

  it('returns the stored group when the planned set removes it', () => {
    expect(shareAudienceToAuthorize(['g-1'], [])).toEqual(['g-1']);
  });

  it('returns both sides of a replacement', () => {
    expect(shareAudienceToAuthorize(['g-1', 'g-2'], ['g-2', 'g-3'])).toEqual(['g-1', 'g-2', 'g-3']);
  });

  it('ignores duplicates on either side', () => {
    expect(shareAudienceToAuthorize(['g-1', 'g-1'], ['g-1'])).toBeNull();
  });
});
