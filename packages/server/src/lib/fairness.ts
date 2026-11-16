/**
 * Fairness counts (#1172, R9): what the cohort got right per item, as counts only.
 *
 * A taught item is labelled and left out of the aggregate — it was declared pre-exposed, so
 * averaging it in would make "graded on what nobody could pre-learn" false. An item with fewer than
 * five respondents is suppressed: with a class of twelve, a two-person cell is one person's answer,
 * not a statistic. Never option-level, because an option distribution is the key.
 */
export const FAIRNESS_MIN_RESPONDENTS = 5;

export interface FairnessInput {
  questionId: string;
  taughtItem: boolean;
  /** Distinct students served the item in a submitted attempt. */
  served: number;
  /** Distinct students whose answer was correct. */
  correct: number;
  /** Distinct students served an item that has no automatic verdict (R16 open items). */
  ungraded: number;
}

export interface FairnessItem {
  questionId: string;
  /** `true` when the teacher declared the item taught: shown as a label, never counted. */
  taughtItem: boolean;
  /** All three are `null` when the cell is excluded or suppressed. */
  served: number | null;
  correct: number | null;
  ungraded: number | null;
}

export function fairnessItem(input: FairnessInput): FairnessItem {
  const hidden = input.taughtItem || input.served < FAIRNESS_MIN_RESPONDENTS;
  return {
    questionId: input.questionId,
    taughtItem: input.taughtItem,
    served: hidden ? null : input.served,
    correct: hidden ? null : input.correct,
    ungraded: hidden ? null : input.ungraded,
  };
}
