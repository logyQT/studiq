/**
 * Preview data only — never a seed, never a fetch.
 *
 * The four cards a lecture hands over: short fronts, one-line backs, a topic on
 * three of them so the tile shows the badge where a real generation puts one.
 * Biology, because that is the lecture the page's other surfaces come from, so a
 * visitor reading top to bottom follows one course rather than four demos.
 *
 * Both locales are authored, not translated at render time (DESIGN §Product
 * imagery: one locale per render, never mixed).
 */
export type GeneratedCardsLocale = 'pl' | 'en';

export interface GeneratedCardFixture {
  front: string;
  back: string;
  topic?: string;
}

export const GENERATED_CARD_FIXTURES: Record<
  GeneratedCardsLocale,
  readonly [GeneratedCardFixture, ...GeneratedCardFixture[]]
> = {
  pl: [
    {
      front: 'Gdzie w komórce powstaje większość ATP?',
      back: 'W mitochondrium.',
      topic: 'Organelle',
    },
    {
      front: 'Co robi aparat Golgiego?',
      back: 'Sortuje i pakuje białka.',
      topic: 'Organelle',
    },
    {
      front: 'Za co odpowiada błona komórkowa?',
      back: 'Oddziela wnętrze komórki od otoczenia.',
      topic: 'Błona',
    },
    {
      front: 'Które organellum trawi zużyte struktury?',
      back: 'Lizosom.',
    },
  ],
  en: [
    {
      front: 'Where in the cell is most ATP produced?',
      back: 'In the mitochondrion.',
      topic: 'Organelles',
    },
    {
      front: 'What does the Golgi apparatus do?',
      back: 'Sorts and packages proteins.',
      topic: 'Organelles',
    },
    {
      front: 'What does the cell membrane do?',
      back: 'Separates the cell from its surroundings.',
      topic: 'Membrane',
    },
    {
      front: 'Which organelle digests worn-out structures?',
      back: 'The lysosome.',
    },
  ],
};
