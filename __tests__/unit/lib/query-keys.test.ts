import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { assignmentKeys, flashcardKeys, questionKeys, topicKeys } from '@/lib/query-keys';

/**
 * Org-scoped list queries resolve their rows from the `active_org_id` cookie on
 * the server, so their cache keys must include the active org (#135). These
 * tests pin the two properties the fix relies on: the key changes with the org
 * (no stale rows after a switch) and the org segment still sits *after* the
 * resource prefix (so every `invalidateQueries` call site keeps matching).
 */
describe('org-scoped query keys (#135)', () => {
  const filters = { owner: 'all', sortBy: 'created_at' };

  it('keys deck lists by the active org', () => {
    const orgA = flashcardKeys.decks.paginated(filters, 'org-a');
    const orgB = flashcardKeys.decks.paginated(filters, 'org-b');

    expect(orgA).not.toEqual(orgB);
    expect(orgA).not.toEqual(flashcardKeys.decks.paginated(filters, null));
    // `undefined` and `null` both normalise to `null`, so the cold-start key is
    // stable before `['orgs']` settles.
    expect(flashcardKeys.decks.paginated(filters)).toEqual(
      flashcardKeys.decks.paginated(filters, null),
    );
  });

  it('keys topic lists by the active org', () => {
    expect(topicKeys.paginated(filters, 'org-a')).not.toEqual(
      topicKeys.paginated(filters, 'org-b'),
    );
    expect(topicKeys.paginated(filters, 'org-a')).not.toEqual(topicKeys.paginated(filters, null));
  });

  it('keys question bank lists by the active org', () => {
    expect(questionKeys.banks.paginated(filters, 'org-a')).not.toEqual(
      questionKeys.banks.paginated(filters, 'org-b'),
    );
    expect(questionKeys.banks.paginated(filters, 'org-a')).not.toEqual(
      questionKeys.banks.paginated(filters, null),
    );
  });

  it('keys deck option pickers by the active org', () => {
    expect(flashcardKeys.decks.options('org-a')).not.toEqual(flashcardKeys.decks.options('org-b'));
    // The pickers must not overload `decks.all` (the invalidation prefix) as a
    // data key.
    expect(flashcardKeys.decks.options('org-a')).not.toEqual(flashcardKeys.decks.all);
  });

  it('still lets filters participate in the key', () => {
    expect(flashcardKeys.decks.paginated({ owner: 'mine' }, 'org-a')).not.toEqual(
      flashcardKeys.decks.paginated({ owner: 'all' }, 'org-a'),
    );
    expect(topicKeys.paginated({ q: 'bio' }, 'org-a')).not.toEqual(
      topicKeys.paginated({}, 'org-a'),
    );
    expect(questionKeys.banks.paginated({ q: 'bio' }, 'org-a')).not.toEqual(
      questionKeys.banks.paginated({}, 'org-a'),
    );
  });

  it('keeps the invalidation prefixes intact', () => {
    const deckKey = flashcardKeys.decks.paginated(filters, 'org-a');
    expect(deckKey.slice(0, flashcardKeys.decks.all.length)).toEqual([...flashcardKeys.decks.all]);

    const deckOptionsKey = flashcardKeys.decks.options('org-a');
    expect(deckOptionsKey.slice(0, flashcardKeys.decks.all.length)).toEqual([
      ...flashcardKeys.decks.all,
    ]);

    const topicKey = topicKeys.paginated(filters, 'org-a');
    expect(topicKey.slice(0, topicKeys.all.length)).toEqual([...topicKeys.all]);

    const bankKey = questionKeys.banks.paginated(filters, 'org-a');
    expect(bankKey.slice(0, questionKeys.banks.all.length)).toEqual([...questionKeys.banks.all]);
  });
});

/**
 * The results table (`results-client.tsx`) reads `assignmentKeys.results(id)`
 * while the grading screen reads `assignmentKeys.studentResults(id, studentId)`.
 * A grading mutation that invalidates only the per-student key leaves the table
 * cached, and `useApiQuery` defaults to `staleTime: Infinity` — so the row keeps
 * saying „Przesłane" until a full reload (#168).
 */
describe('assignment results grading invalidation (#168)', () => {
  const assignmentId = 'assignment-1';
  const studentId = 'student-1';
  const listKey = assignmentKeys.results(assignmentId);
  const studentKey = assignmentKeys.studentResults(assignmentId, studentId);

  it('invalidates the results list prefix', () => {
    expect(assignmentKeys.gradingInvalidations(assignmentId)).toEqual([listKey]);
  });

  it('nests the per-student key under the list prefix', () => {
    expect(studentKey.slice(0, listKey.length)).toEqual([...listKey]);
  });

  it('marks the results list and the per-student query invalidated', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(listKey, [{ id: 'attempt-1' }]);
    queryClient.setQueryData(studentKey, { id: 'attempt-1', graded_at: null });

    for (const key of assignmentKeys.gradingInvalidations(assignmentId)) {
      queryClient.invalidateQueries({ queryKey: key });
    }

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(studentKey)?.isInvalidated).toBe(true);
  });

  it('leaves the results list cached when only the per-student key is invalidated', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(listKey, [{ id: 'attempt-1' }]);
    queryClient.setQueryData(studentKey, { id: 'attempt-1', graded_at: null });

    // The pre-fix behaviour — this is the control that proves the test would
    // catch a regression back to the per-student-only key.
    queryClient.invalidateQueries({ queryKey: studentKey });

    expect(queryClient.getQueryState(studentKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
  });
});
