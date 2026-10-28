/**
 * What the current user may do inside a question bank. A bank shared with a group is readable by
 * its members, but only people who may update the bank (author, teacher, manager) may change its
 * questions - the API answers 403 to everyone else, so the UI must not offer the actions at all.
 * While the bank is still loading nothing is offered and no read-only notice is shown.
 */
export function bankAccess(bankLoaded: boolean, canUpdateBank: boolean) {
  const editable = bankLoaded && canUpdateBank;
  return {
    readOnly: bankLoaded && !canUpdateBank,
    canCreateQuestion: editable,
    allowQuestionAction: (allowedOnQuestion: boolean) => editable && allowedOnQuestion,
  };
}
