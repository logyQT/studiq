import type { NotesItem } from '@studiq/server/services/ai-utils';
import { describe, expect, it } from 'vitest';
import { notesFromToolOutput, notesToFlashcards, notesToMarkdown } from '@/lib/ai-notes';

const notes: NotesItem = {
  title: 'Photosynthesis',
  sections: [
    { heading: 'Light reactions', content: 'Chlorophyll absorbs light.' },
    { heading: 'Calvin cycle', content: 'CO2 is fixed into sugar.' },
  ],
  keyTerms: [
    { term: 'Chlorophyll', definition: 'The pigment that absorbs light.' },
    { term: 'Stroma', definition: '' },
  ],
  summary: 'Plants turn light into sugar.',
};

describe('notesFromToolOutput', () => {
  it('reads the output of a successful call', () => {
    expect(notesFromToolOutput({ type: 'notes', ...notes })).toEqual(notes);
  });

  it.each([
    ['an error output', { type: 'error', error: 'no sections' }],
    ['another tool output', { type: 'flashcards', flashcards: [] }],
    ['an output with nothing in it', { type: 'notes', title: 'Only a title' }],
    ['nothing', undefined],
    ['text', 'notes'],
    ['null', null],
  ])('gives nothing for %s', (_label, output) => {
    expect(notesFromToolOutput(output)).toBeNull();
  });
});

describe('notesToFlashcards', () => {
  it('makes a card of every key term that has a definition', () => {
    expect(notesToFlashcards(notes)).toEqual([
      { front: 'Chlorophyll', back: 'The pigment that absorbs light.' },
    ]);
  });

  it('falls back to the sections when there are no usable terms', () => {
    expect(notesToFlashcards({ ...notes, keyTerms: [] })).toEqual([
      { front: 'Light reactions', back: 'Chlorophyll absorbs light.' },
      { front: 'Calvin cycle', back: 'CO2 is fixed into sugar.' },
    ]);
  });

  it('skips sections without a heading or a body, and gives no cards when none is left', () => {
    expect(
      notesToFlashcards({
        ...notes,
        keyTerms: [],
        sections: [
          { heading: '', content: 'body only' },
          { heading: 'heading only', content: '' },
        ],
      }),
    ).toEqual([]);
  });
});

describe('notesToMarkdown', () => {
  const labels = { keyTerms: 'Key terms', summary: 'Summary' };

  it('writes the title, the sections, the terms and the summary in that order', () => {
    const expected = [
      '# Photosynthesis',
      '## Light reactions\n\nChlorophyll absorbs light.',
      '## Calvin cycle\n\nCO2 is fixed into sugar.',
      '## Key terms\n\n- **Chlorophyll**: The pigment that absorbs light.\n- **Stroma**',
      '## Summary\n\nPlants turn light into sugar.',
    ].join('\n\n');
    expect(notesToMarkdown(notes, labels)).toBe(`${expected}\n`);
  });

  it('leaves no empty heading behind', () => {
    const bodyOnly: NotesItem = {
      title: '',
      sections: [{ heading: '', content: 'Just a body.' }],
      keyTerms: [],
      summary: '',
    };
    expect(notesToMarkdown(bodyOnly, labels)).toBe('Just a body.\n');
  });

  it('uses the labels it is given, so the copy speaks the language of the UI', () => {
    const text = notesToMarkdown(notes, { keyTerms: 'Kluczowe pojęcia', summary: 'Podsumowanie' });
    expect(text).toContain('## Kluczowe pojęcia');
    expect(text).toContain('## Podsumowanie');
  });
});
