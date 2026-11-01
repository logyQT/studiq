import { describe, expect, it } from 'vitest';
import { languageFilter } from '@/lib/language-filter';

const english = ['English', ['en', 'angielski', 'English', 'english', 'angielski']] as const;
const german = ['Deutsch', ['de', 'niemiecki', 'German', 'deutsch', 'german']] as const;
const spanish = ['Español', ['es', 'hiszpański', 'Spanish']] as const;
const ukrainian = ['Українська', ['uk', 'ukraiński', 'Ukrainian']] as const;

const match = ([value, keywords]: readonly [string, readonly string[]], query: string) =>
  languageFilter(value, query, [...keywords]);

describe('languageFilter', () => {
  it('shows everything for an empty query', () => {
    expect(match(english, '')).toBe(1);
    expect(match(german, '   ')).toBe(1);
  });

  it('matches word prefixes of the endonym, localized names and codes', () => {
    expect(match(english, 'ang')).toBe(1);
    expect(match(english, 'EN')).toBe(1);
    expect(match(german, 'niem')).toBe(1);
    expect(match(german, 'ger')).toBe(1);
  });

  it('does not match scattered letters (cmdk fuzzy matched "ang" to Deutsch)', () => {
    expect(match(german, 'ang')).toBe(0);
    expect(match(english, 'xyz')).toBe(0);
  });

  it('ignores diacritics and case', () => {
    expect(match(spanish, 'espanol')).toBe(1);
    expect(match(spanish, 'hiszpanski')).toBe(1);
    expect(match(ukrainian, 'ukrainski')).toBe(1);
  });

  it('ranks matches inside a word below word prefixes', () => {
    expect(match(english, 'glish')).toBe(0.5);
  });
});
