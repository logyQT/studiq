import { resolveStoredScope } from '@studiq/authz';
import { describe, expect, it } from 'vitest';

/**
 * A stored `org_role_permissions` row resolves only to a scope its catalog key
 * allows (#961). A content write cannot hold `group`; a key the catalog does not
 * know keeps its stored scope, because the catalog cannot judge it.
 */

describe('resolveStoredScope', () => {
  it('drops a group scope the key does not allow', () => {
    expect(resolveStoredScope('deck.update', 'group')).toBeNull();
    expect(resolveStoredScope('flashcard.create', 'group')).toBeNull();
    expect(resolveStoredScope('question_bank.delete', 'group')).toBeNull();
  });

  it('keeps a group scope the key still allows', () => {
    expect(resolveStoredScope('deck.read', 'group')).toBe('group');
    expect(resolveStoredScope('assignment.update', 'group')).toBe('group');
  });

  it('keeps an allowed write scope', () => {
    expect(resolveStoredScope('deck.update', 'own')).toBe('own');
    expect(resolveStoredScope('deck.update', 'organization')).toBe('organization');
  });

  it('leaves an unknown key untouched', () => {
    expect(resolveStoredScope('legacy.read', 'group')).toBe('group');
  });
});
