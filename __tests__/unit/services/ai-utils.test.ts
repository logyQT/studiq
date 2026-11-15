import { parseNotes } from '@studiq/server/services/ai-utils';
import { describe, expect, it } from 'vitest';

describe('parseNotes', () => {
  const notes = {
    title: 'Cells',
    sections: [{ heading: 'Membrane', content: 'Lipid bilayer.' }],
    keyTerms: [{ term: 'Nucleus', definition: 'Holds the DNA.' }],
    summary: 'Cells are the unit of life.',
  };

  it('reads an object and a JSON string the same way', () => {
    expect(parseNotes(notes)).toEqual(notes);
    expect(parseNotes(JSON.stringify(notes))).toEqual(notes);
  });

  it('gives empty notes for anything that is not an object', () => {
    const empty = { title: '', sections: [], keyTerms: [], summary: '' };
    for (const raw of [undefined, null, 42, true, '', 'not json', '[1,2]', [], [notes]]) {
      expect(parseNotes(raw)).toEqual(empty);
    }
  });

  it('skips list entries that are not objects and fields that are not lists', () => {
    expect(
      parseNotes({
        title: 'T',
        sections: [null, 'text', 7, ['nested'], { heading: 'Kept', content: 'Body' }],
        keyTerms: 'oops',
      }),
    ).toEqual({
      title: 'T',
      sections: [{ heading: 'Kept', content: 'Body' }],
      keyTerms: [],
      summary: '',
    });
  });

  it('turns a non-text field into text instead of "[object Object]"', () => {
    const parsed = parseNotes({
      title: 12,
      sections: [{ heading: 'H', content: { nested: true } }],
      summary: null,
    });
    expect(parsed.title).toBe('12');
    expect(parsed.sections[0]?.content).toBe('{"nested":true}');
    expect(parsed.summary).toBe('');
  });

  it('does not share its result with the input', () => {
    const section = { heading: 'H', content: 'C' };
    const parsed = parseNotes({ sections: [section] });
    expect(parsed.sections[0]).not.toBe(section);
  });
});
