export interface CalculateReviewParams {
  wasCorrect: boolean;
  confidenceLevel?: number;
  currentEF: number;
  currentInterval: number;
  currentRepetitions: number;
}

export interface ReviewResult {
  newEF: number;
  newInterval: number;
  newRepetitions: number;
  nextReviewAt: Date;
}

export class FlashcardSpacedRepetitionService {
  private mapToQuality(wasCorrect: boolean, confidenceLevel?: number): number {
    if (!wasCorrect) {
      if (confidenceLevel == null) return 0;
      if (confidenceLevel <= 1) return 0;
      if (confidenceLevel === 2) return 1;
      return 2;
    }
    if (confidenceLevel == null) return 4;
    if (confidenceLevel <= 2) return 3;
    if (confidenceLevel === 3) return 4;
    if (confidenceLevel === 4) return 4;
    return 5;
  }

  calculateNextReview(params: CalculateReviewParams): ReviewResult {
    const quality = this.mapToQuality(params.wasCorrect, params.confidenceLevel);
    let { currentEF, currentInterval, currentRepetitions } = params;

    if (quality >= 3) {
      currentRepetitions += 1;

      if (currentRepetitions === 1) {
        currentInterval = 1;
      } else if (currentRepetitions === 2) {
        currentInterval = 6;
      } else {
        currentInterval = Math.round(currentInterval * currentEF);
      }

      currentEF = currentEF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
      if (currentEF < 1.3) currentEF = 1.3;
    } else {
      currentRepetitions = 0;
      currentInterval = 1;
    }

    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + currentInterval);
    nextReviewAt.setHours(0, 0, 0, 0);

    return {
      newEF: Math.round(currentEF * 100) / 100,
      newInterval: currentInterval,
      newRepetitions: currentRepetitions,
      nextReviewAt,
    };
  }
}

export const flashcardSpacedRepetitionService = new FlashcardSpacedRepetitionService();
