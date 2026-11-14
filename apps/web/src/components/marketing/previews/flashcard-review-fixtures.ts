/**
 * Preview data only — never a seed, never a fetch.
 *
 * The three cards are drawn from the demo tenants' own course material
 * (`supabase/seeds/demo/demo-{pl,en}.sql`): pharmacology and physiology, the
 * kind of deck a student brings to StudiQ. Both locales are authored rather
 * than translated at render time, so a Polish page cannot wrap English cards.
 *
 * The lengths differ on purpose — a one-line answer, a two-line answer and a
 * three-line question — because the preview must prove the card box does not
 * move when the fixture does.
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
      id: 'pharm-statin',
      front: 'Co hamuje statyna?',
      back: 'Reduktazę HMG-CoA, enzym limitujący syntezę cholesterolu.',
    },
    {
      id: 'phys-adh',
      front: 'Który hormon zwiększa wchłanianie wody w kanaliku zbiorczym?',
      back: 'Wazopresyna (ADH), działająca przez kanały akwaporyny-2.',
    },
    {
      id: 'phys-ph',
      front: 'Jaki jest prawidłowy zakres pH krwi tętniczej?',
      back: '7,35–7,45.',
    },
  ],
  en: [
    {
      id: 'pharm-statin',
      front: 'What does a statin inhibit?',
      back: 'HMG-CoA reductase, the rate-limiting enzyme of cholesterol synthesis.',
    },
    {
      id: 'phys-adh',
      front: 'Which hormone increases water reabsorption in the collecting duct?',
      back: 'Antidiuretic hormone (vasopressin), via aquaporin-2 channels.',
    },
    {
      id: 'phys-ph',
      front: 'What is the normal pH range of arterial blood?',
      back: '7.35–7.45.',
    },
  ],
};
