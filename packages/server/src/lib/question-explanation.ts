import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import type { ZodIssue } from 'zod';

/**
 * The authoring rules for the post-close teaching artefact (R16/R17).
 *
 * An explanation is what a student reads after the close, so it has to teach the reasoning
 * instead of labelling the key: it is required for choice items, has a floor that rules out
 * "B" or "the second one", and may not quote an option back at the reader. An open item has no
 * key, so its artefact is a model answer.
 *
 * Pure on purpose: the server schemas, the question service (for a merged update) and the
 * authoring form (for inline errors) all call these functions, so the rule cannot drift between
 * them.
 */

/** Roughly one sentence of reasoning: below this the text is a label, not a teaching artefact. */
export const EXPLANATION_MIN_LENGTH = 80;
/** 8 × the pre-R16 cap: a paragraph, still bounded so a question list stays small. */
export const EXPLANATION_MAX_LENGTH = 2040;
/** The open item's answer is the same kind of artefact, so it gets the same bound. */
export const MODEL_ANSWER_MAX_LENGTH = 2040;
/**
 * Below this length an option is too generic to be "handed over" by quoting it: "2", "Prawda"
 * or "Wisła" appear in honest explanations by coincidence, not as a leak.
 */
export const VERBATIM_OPTION_MIN_LENGTH = 12;

/** The types that carry an answer key, and therefore require an explanation. */
const CHOICE_TYPES = new Set(['mcq', 'true_false']);

export function isChoiceType(type: string): boolean {
  return CHOICE_TYPES.has(type);
}

/** What the rules need to judge one item: its type, its two artefacts and its option texts. */
export interface QuestionTextInput {
  type: string;
  explanation: string | null | undefined;
  modelAnswer: string | null | undefined;
  options: readonly string[];
}

function issue(path: string, message: string): ZodIssue {
  return { code: 'custom', path: [path], message };
}

/**
 * Every authoring problem of one item, as per-field issues (`explanation`, `modelAnswer`) so the
 * controller answers a 422 the form can render under the right field. An empty list means the
 * item is publishable.
 *
 * Length caps are also enforced by the field schemas; they are not repeated here.
 */
export function questionTextIssues(input: QuestionTextInput): ZodIssue[] {
  if (!isChoiceType(input.type)) {
    if (!input.modelAnswer?.trim()) {
      return [issue('modelAnswer', ValidationErrorCode.MODEL_ANSWER_REQUIRED)];
    }
    return [];
  }

  const explanation = input.explanation ?? '';
  if (!explanation.trim()) {
    return [issue('explanation', ValidationErrorCode.EXPLANATION_REQUIRED)];
  }
  if (explanation.trim().length < EXPLANATION_MIN_LENGTH) {
    return [issue('explanation', ValidationErrorCode.EXPLANATION_TOO_SHORT)];
  }
  if (namesAnOption(explanation)) {
    return [issue('explanation', ValidationErrorCode.EXPLANATION_NAMES_OPTION)];
  }
  if (quotesAnOption(explanation, input.options)) {
    return [issue('explanation', ValidationErrorCode.EXPLANATION_QUOTES_OPTION)];
  }
  return [];
}

// A word that turns the next token into a reference to an option, in both product locales.
const OPTION_NOUN =
  'opcj\\p{L}*|odpowied\\p{L}*|wariant\\p{L}*|liter\\p{L}*|option\\p{L}*|answer\\p{L}*|choice\\p{L}*|letter\\p{L}*';
const EN_ORDINAL = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth';
const PL_ORDINAL =
  'pierwsz\\p{L}*|drug\\p{L}*|trzeci\\p{L}*|czwart\\p{L}*|piąt\\p{L}*|szóst\\p{L}*|siódm\\p{L}*|ósm\\p{L}*|dziewiąt\\p{L}*|dziesiąt\\p{L}*';

/**
 * A standalone option letter: "B", "B)", "(B)", "B:" — never a letter inside a word ("Bzdura",
 * "AB", "B2B") and never the English article ("A student…"), which is why the letter has to be
 * followed by a label mark or preceded by an option noun.
 */
const OPTION_LETTER = new RegExp(
  String.raw`(?:^|[\s(])[A-H][).:](?=\s|$)|(?:${OPTION_NOUN})\s*:?\s*\(?[A-Ha-h]\)?(?=\s|$|[,.;:])`,
  'iu',
);

/** An ordinal that points at an option: "the second one", "druga odpowiedź", "odpowiedź 2". */
const OPTION_ORDINAL = new RegExp(
  String.raw`\b(?:${EN_ORDINAL})\s+(?:one|option|answer|choice)\b|\b(?:option|answer|choice)\s+(?:number\s+)?(?:${EN_ORDINAL})\b|(?:${PL_ORDINAL})(?:\s+\p{L}+){0,2}\s+(?:${OPTION_NOUN})|(?:${OPTION_NOUN})(?:\s+\p{L}+){0,2}\s+(?:${PL_ORDINAL})|(?:${OPTION_NOUN})\s*(?:nr|number|#)?\s*:?\s*\d+`,
  'iu',
);

/** Whether the text points at an option by its label instead of explaining the reasoning. */
export function namesAnOption(explanation: string): boolean {
  return OPTION_LETTER.test(explanation) || OPTION_ORDINAL.test(explanation);
}

/**
 * Case-, diacritic-, whitespace- and punctuation-insensitive form of a text, so a quoted option
 * is caught however the author retyped it. `ł` does not decompose under NFD, so it is mapped
 * explicitly — "Wisła" and "wisla" are the same option to a reader.
 */
export function normalizeOptionText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whether the text repeats an option word for word, at the length where that is a real leak. */
export function quotesAnOption(explanation: string, options: readonly string[]): boolean {
  const text = normalizeOptionText(explanation);
  return options.some((option) => {
    const normalized = normalizeOptionText(option);
    return normalized.length >= VERBATIM_OPTION_MIN_LENGTH && text.includes(normalized);
  });
}
