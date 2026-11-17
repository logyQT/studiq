import {
  EXPLANATION_MIN_LENGTH,
  normalizeOptionText,
  questionTextIssues,
} from '@studiq/server/lib/question-explanation';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { describe, expect, it } from 'vitest';

// R16/R17: the explanation is the post-close teaching artefact, so it has to teach instead of
// labelling the key, and an open item needs a model answer because it has no key to explain.
// These are the rules the schema, the question service and the authoring form all call.

const TEACHING =
  'Wisła jest najdłuższą rzeką w Polsce i uchodzi do Bałtyku, dlatego wyznacza oś hydrograficzną kraju, a pozostałe rzeki są od niej krótsze.';

const RIVERS = ['Wisła', 'Odra'];

function issues(input: {
  type?: string;
  explanation?: string | null;
  modelAnswer?: string | null;
  options?: string[];
}) {
  return questionTextIssues({
    type: input.type ?? 'mcq',
    explanation: input.explanation,
    modelAnswer: input.modelAnswer,
    options: input.options ?? RIVERS,
  });
}

describe('questionTextIssues: the choice item explanation (R16)', () => {
  it('requires an explanation for every choice type', () => {
    for (const type of ['mcq', 'true_false']) {
      const [issue] = issues({ type });
      expect(issue?.path, type).toEqual(['explanation']);
      expect(issue?.message, type).toBe(ValidationErrorCode.EXPLANATION_REQUIRED);
    }
  });

  it('treats a whitespace-only explanation as missing', () => {
    expect(issues({ explanation: '   \n  ' })[0]?.message).toBe(
      ValidationErrorCode.EXPLANATION_REQUIRED,
    );
  });

  it('rejects an explanation below the teaching floor', () => {
    const short = 'Wisła jest najdłuższa.';
    expect(short.length).toBeLessThan(EXPLANATION_MIN_LENGTH);
    const [issue] = issues({ explanation: short });
    expect(issue?.path).toEqual(['explanation']);
    expect(issue?.message).toBe(ValidationErrorCode.EXPLANATION_TOO_SHORT);
  });

  it('accepts an explanation that teaches the reasoning', () => {
    expect(issues({ explanation: TEACHING })).toEqual([]);
  });

  it('does not require a model answer for a choice item', () => {
    expect(issues({ explanation: TEACHING, modelAnswer: null })).toEqual([]);
  });
});

describe('questionTextIssues: the open item model answer (R16)', () => {
  it('requires a model answer instead of an explanation', () => {
    const [issue] = issues({ type: 'open', explanation: TEACHING });
    expect(issue?.path).toEqual(['modelAnswer']);
    expect(issue?.message).toBe(ValidationErrorCode.MODEL_ANSWER_REQUIRED);
  });

  it('accepts an open item that carries only a model answer', () => {
    expect(
      issues({ type: 'open', modelAnswer: 'Woda paruje, skrapla się i spada jako opad.' }),
    ).toEqual([]);
  });

  it('does not apply the choice-item checks to an open item', () => {
    // A model answer may quote an option-shaped phrase and needs no explanation: the rules are
    // about the artefact the item actually has.
    expect(issues({ type: 'open', modelAnswer: 'Odpowiedź B: Wisła', explanation: 'B' })).toEqual(
      [],
    );
  });
});

describe('questionTextIssues: text that hands over an option (R17)', () => {
  it('rejects an option letter in a teaching-length explanation', () => {
    const [issue] = issues({
      explanation: `Odpowiedź B jest poprawna, ponieważ Wisła jest najdłuższą rzeką w Polsce i uchodzi do Bałtyku.`,
    });
    expect(issue?.path).toEqual(['explanation']);
    expect(issue?.message).toBe(ValidationErrorCode.EXPLANATION_NAMES_OPTION);
  });

  it('rejects a label-style letter at the start of a sentence', () => {
    const [issue] = issues({
      explanation: `B) Wisła jest najdłuższą rzeką w Polsce, bo uchodzi do Bałtyku i zbiera wody z połowy kraju.`,
    });
    expect(issue?.message).toBe(ValidationErrorCode.EXPLANATION_NAMES_OPTION);
  });

  it('rejects a Polish ordinal that points at an option', () => {
    const [issue] = issues({
      explanation:
        'Prawidłowa jest druga odpowiedź, bo Wisła jest dłuższa od Odry i uchodzi do Bałtyku, zbierając wody z połowy kraju.',
    });
    expect(issue?.message).toBe(ValidationErrorCode.EXPLANATION_NAMES_OPTION);
  });

  it('rejects an English ordinal that points at an option', () => {
    const [issue] = issues({
      explanation:
        'The second one is right: the Vistula is the longest river in Poland and reaches the Baltic Sea.',
    });
    expect(issue?.message).toBe(ValidationErrorCode.EXPLANATION_NAMES_OPTION);
  });

  it('rejects an option number after an option noun', () => {
    const [issue] = issues({
      explanation:
        'Poprawna opcja 2 jest właściwa, ponieważ Wisła jest najdłuższą rzeką w Polsce i uchodzi do Bałtyku.',
    });
    expect(issue?.message).toBe(ValidationErrorCode.EXPLANATION_NAMES_OPTION);
  });

  it('rejects a positional reference to the last option', () => {
    // "the last one" hands the key over exactly like "B" does, in either locale.
    for (const explanation of [
      'The last one is right: the Vistula is the longest river in Poland and reaches the Baltic Sea.',
      'Ostatnia odpowiedź jest poprawna, bo Wisła jest dłuższa od Odry i uchodzi do Bałtyku.',
    ]) {
      expect(issues({ explanation })[0]?.message, explanation).toBe(
        ValidationErrorCode.EXPLANATION_NAMES_OPTION,
      );
    }
  });

  it('rejects a bare numbered option label', () => {
    for (const explanation of [
      '1) Wisła jest najdłuższą rzeką w Polsce i uchodzi do Bałtyku, zbierając wody z połowy kraju.',
      'Poprawna jest 2), ponieważ Wisła jest dłuższa od Odry i uchodzi do Bałtyku na północy.',
    ]) {
      expect(issues({ explanation })[0]?.message, explanation).toBe(
        ValidationErrorCode.EXPLANATION_NAMES_OPTION,
      );
    }
  });

  it('rejects an option quoted verbatim', () => {
    const [issue] = issues({
      explanation:
        'Warszawa jest stolicą Polski od 1596 roku, więc wybór jest prawidłowy i wynika z historii kraju.',
      options: ['Warszawa jest stolicą Polski', 'Kraków był stolicą do 1596 roku'],
    });
    expect(issue?.message).toBe(ValidationErrorCode.EXPLANATION_QUOTES_OPTION);
  });

  it('catches a quote retyped without case, diacritics or punctuation', () => {
    const [issue] = issues({
      explanation:
        'WARSZAWA JEST STOLICA POLSKI — tak brzmi zdanie, które opisuje prawidłowy wybór w tym pytaniu.',
      options: ['Warszawa jest stolicą Polski'],
    });
    expect(issue?.message).toBe(ValidationErrorCode.EXPLANATION_QUOTES_OPTION);
  });
});

describe('questionTextIssues: keeping false positives out (R17)', () => {
  it('does not read a letter inside a word as an option label', () => {
    for (const explanation of [
      'Bzdura, bo Wisła jest najdłuższą rzeką w Polsce i uchodzi do Bałtyku, zbierając wody z połowy kraju.',
      'AB i B2B to skróty, a Wisła pozostaje najdłuższą rzeką w Polsce i uchodzi do Bałtyku, co widać na mapie.',
    ]) {
      expect(issues({ explanation, options: ['Wisła'] }), explanation).toEqual([]);
    }
  });

  it('does not read the English article as an option letter', () => {
    expect(
      issues({
        explanation:
          'A student who reads the map sees that the Vistula is the longest river in Poland and reaches the Baltic.',
        options: ['Vistula'],
      }),
    ).toEqual([]);
  });

  it('does not flag an ordinal that is not about an option', () => {
    expect(
      issues({
        explanation:
          'The second half of the nineteenth century brought the river its current course, and the delta moved north.',
        options: ['Vistula'],
      }),
    ).toEqual([]);
  });

  it('does not flag a numeral that only looks like an option label', () => {
    // "2. zasada dynamiki" is a numbered law, "(2)" a formula number, "966" a year.
    for (const explanation of [
      '2. zasada dynamiki mówi o bezwładności, więc ciało bez siły pozostaje w spoczynku, a to wyjaśnia treść zadania.',
      'Wzór (2) opisuje ruch jednostajny, a w 966 roku Mieszko I przyjął chrzest, co zmieniło bieg historii kraju.',
    ]) {
      expect(issues({ explanation }), explanation).toEqual([]);
    }
  });

  it('does not flag a short option quoted verbatim', () => {
    // "2" and "Prawda" appear in honest explanations; only an option of 12+ characters is long
    // enough for a quote to be a hand-over.
    expect(
      issues({
        explanation:
          'Liczba 2 jest poprawna, ponieważ dodanie dwóch jedynek daje dokładnie dwa, a nie trzy.',
        options: ['2', '3'],
      }),
    ).toEqual([]);
    expect(
      issues({
        explanation:
          'Prawda, ponieważ woda pod normalnym ciśnieniem zamarza w zerze stopni Celsjusza, co potwierdza doświadczenie.',
        options: ['Prawda', 'Fałsz'],
      }),
    ).toEqual([]);
  });

  it('does not flag an eleven-character option quoted verbatim', () => {
    const option = 'Wisła 1047k';
    expect(
      issues({
        explanation: `Wisła 1047k to zapis, który pojawia się w tym zdaniu, a rzeka uchodzi do Bałtyku.`,
        options: [option],
      }),
    ).toEqual([]);
  });
});

describe('normalizeOptionText', () => {
  it('folds case, diacritics, punctuation and whitespace', () => {
    expect(normalizeOptionText('  Wisła — NAJDŁUŻSZA,  rzeka! ')).toBe('wisla najdluzsza rzeka');
  });
});
