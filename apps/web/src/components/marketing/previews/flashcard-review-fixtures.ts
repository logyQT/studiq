/**
 * Preview data only — never a seed, never a fetch.
 *
 * Three cards a visitor can answer without knowing anything about StudiQ:
 * general knowledge in the register of a mixed study deck — a language, a
 * science fact. Short on purpose. The landing page has seconds to
 * show what the product does, and a medical answer running to seven lines spent
 * those seconds on terminology instead of on the card.
 *
 * The first card is the one exception: the product's own name as a one-word
 * answer, so the flip lands and the visitor meets StudiQ inside the card rather
 * than in a badge. Cards two and three stay real study content — the demo shows
 * the product working, not talking about itself.
 *
 * The two sets are authored separately rather than translated, so each reads
 * like a card that locale's student would actually write. Lengths differ on
 * purpose — a one-word answer, a longer question, a numeric answer — because
 * the preview must prove the card box does not move when the fixture does.
 */
export type FlashcardFixtureLocale = 'pl' | 'en';

export interface FlashcardReviewFixture {
  id: string;
  front: string;
  back: string;
}

export const FLASHCARD_REVIEW_FIXTURES: Record<
  FlashcardFixtureLocale,
  readonly [FlashcardReviewFixture, ...FlashcardReviewFixture[]]
> = {
  pl: [
    {
      id: 'geo-capital',
      front: 'Z kim się dziś uczysz?',
      back: 'Ze StudiQ',
    },
    {
      id: 'lang-brazil',
      front: 'W jakim języku mówi się w Brazylii?',
      back: 'Portugalsku',
    },
    {
      id: 'astro-planets',
      front: 'Ile planet ma Układ Słoneczny?',
      back: 'Osiem',
    },
  ],
  en: [
    {
      id: 'geo-capital',
      front: "Who's your study buddy?",
      back: 'StudiQ',
    },
    {
      id: 'lang-brazil',
      front: 'What language is spoken in Brazil?',
      back: 'Portuguese',
    },
    {
      id: 'bio-bones',
      front: 'How many bones are in the human body?',
      back: '206',
    },
  ],
};
