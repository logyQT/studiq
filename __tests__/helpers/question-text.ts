/**
 * The authoring artefacts a test fixture needs (#1173, R16/R17).
 *
 * A choice item cannot be saved without an explanation of at least 80 characters that does not
 * hand over an option, and an open item needs a model answer. Fixtures go through the real API,
 * so they use this copy instead of a label like `explanation-1`.
 */
export function fixtureExplanation(label: string): string {
  return `Wyjaśnienie do pytania ${label}: poprawne jest rozwiązanie zgodne z kluczem, a dystraktor, który studenci mylą najczęściej, wynika z nieuwagi przy czytaniu treści zadania.`;
}

/** The same explanation as a constant, for payloads whose label is not known at the call site. */
export const FIXTURE_EXPLANATION = fixtureExplanation('testowe');

/** The open item's answer artefact: what a good answer contains, in one or two sentences. */
export const FIXTURE_MODEL_ANSWER =
  'Dobra odpowiedź wymienia trzy przyczyny i krótko uzasadnia każdą z nich, odwołując się do przykładu z lekcji.';
