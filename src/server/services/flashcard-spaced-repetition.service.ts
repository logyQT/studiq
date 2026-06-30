import type { CalculateNextReviewInput, CalculateNextReviewOutput, Rating } from '@/server/models';

export class FlashcardSpacedRepetitionService {
  private readonly MAX_INTERVAL_DAYS = 365;

  calculateNextReview(input: CalculateNextReviewInput): CalculateNextReviewOutput {
    switch (input.learningState) {
      case 'new':
        return this.handleNew(input);
      case 'learning':
        return this.handleLearningStep('learning', input);
      case 'review':
        return this.handleReview(input);
      case 'relearning':
        return this.handleLearningStep('relearning', input);
    }
  }

  checkLeech(lapseCount: number, threshold: number): boolean {
    return lapseCount >= threshold;
  }

  mapToQuality(rating: Rating): number {
    const mapping: Record<Rating, number> = { 1: 0, 2: 2, 3: 3, 4: 5 };
    return mapping[rating];
  }

  private handleNew(input: CalculateNextReviewInput): CalculateNextReviewOutput {
    if (input.rating === 4) {
      return this.graduateToReview(input.easinessFactor, input.lapseCount, input.leechThreshold);
    }
    const delay = input.learningSteps[0] ?? 1;
    const nextReviewAt = new Date(Date.now() + delay * 60 * 1000);
    return {
      learningState: 'learning',
      learningStep: 0,
      newEasinessFactor: input.easinessFactor,
      newInterval: delay,
      newRepetitions: 0,
      nextReviewAt,
      intervalUnit: 'minutes',
      lapseCount: input.lapseCount,
      isLeech: this.checkLeech(input.lapseCount, input.leechThreshold),
    };
  }

  private handleLearningStep(
    currentState: 'learning' | 'relearning',
    input: CalculateNextReviewInput,
  ): CalculateNextReviewOutput {
    const { currentStep, learningSteps, rating, easinessFactor, lapseCount, leechThreshold } =
      input;
    const totalSteps = learningSteps.length;

    const scheduleMinutes = (delayMinutes: number) => {
      const d = new Date(Date.now() + delayMinutes * 60 * 1000);
      return d;
    };

    switch (rating) {
      case 1: {
        const delay = learningSteps[0] ?? 1;
        return {
          learningState: currentState,
          learningStep: 0,
          newEasinessFactor: easinessFactor,
          newInterval: delay,
          newRepetitions: 0,
          nextReviewAt: scheduleMinutes(delay),
          intervalUnit: 'minutes',
          lapseCount,
          isLeech: this.checkLeech(lapseCount, leechThreshold),
        };
      }
      case 2: {
        const base = learningSteps[Math.min(currentStep, totalSteps - 1)] ?? 1;
        const delay = Math.round(base * 1.5);
        return {
          learningState: currentState,
          learningStep: currentStep,
          newEasinessFactor: easinessFactor,
          newInterval: delay,
          newRepetitions: 0,
          nextReviewAt: scheduleMinutes(delay),
          intervalUnit: 'minutes',
          lapseCount,
          isLeech: this.checkLeech(lapseCount, leechThreshold),
        };
      }
      case 3: {
        if (currentStep >= totalSteps - 1) {
          return this.graduateToReview(easinessFactor, lapseCount, leechThreshold);
        }
        const nextStep = currentStep + 1;
        const delay = learningSteps[nextStep] ?? 10;
        return {
          learningState: currentState,
          learningStep: nextStep,
          newEasinessFactor: easinessFactor,
          newInterval: delay,
          newRepetitions: 0,
          nextReviewAt: scheduleMinutes(delay),
          intervalUnit: 'minutes',
          lapseCount,
          isLeech: this.checkLeech(lapseCount, leechThreshold),
        };
      }
      case 4: {
        return this.graduateToReview(easinessFactor, lapseCount, leechThreshold);
      }
    }
  }

  private handleReview(input: CalculateNextReviewInput): CalculateNextReviewOutput {
    if (input.rating === 1) {
      const newLapseCount = input.lapseCount + 1;
      const delay = input.learningSteps[0] ?? 1;
      const nextReviewAt = new Date(Date.now() + delay * 60 * 1000);
      return {
        learningState: 'relearning',
        learningStep: 0,
        newEasinessFactor: input.easinessFactor,
        newInterval: delay,
        newRepetitions: input.repetitions,
        nextReviewAt,
        intervalUnit: 'minutes',
        lapseCount: newLapseCount,
        isLeech: this.checkLeech(newLapseCount, input.leechThreshold),
      };
    }

    const qualityMap: Record<number, number> = { 2: 2, 3: 3, 4: 5 };
    const quality = qualityMap[input.rating];

    let newEF = input.easinessFactor;
    let newInterval = input.interval;
    const newRepetitions = input.repetitions + 1;

    if (newRepetitions === 1) {
      newInterval = 1;
    } else if (newRepetitions === 2) {
      newInterval = 6;
    } else {
      newInterval = Math.round(newInterval * newEF);
    }

    newEF = newEF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (newEF < 1.3) newEF = 1.3;
    if (newInterval > this.MAX_INTERVAL_DAYS) newInterval = this.MAX_INTERVAL_DAYS;

    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + newInterval);
    nextReviewAt.setHours(0, 0, 0, 0);

    return {
      learningState: 'review',
      learningStep: 0,
      newEasinessFactor: Math.round(newEF * 100) / 100,
      newInterval,
      newRepetitions,
      nextReviewAt,
      intervalUnit: 'days',
      lapseCount: input.lapseCount,
      isLeech: this.checkLeech(input.lapseCount, input.leechThreshold),
    };
  }

  private graduateToReview(
    easinessFactor: number,
    lapseCount: number,
    leechThreshold: number,
  ): CalculateNextReviewOutput {
    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + 1);
    nextReviewAt.setHours(0, 0, 0, 0);

    return {
      learningState: 'review',
      learningStep: 0,
      newEasinessFactor: easinessFactor,
      newInterval: 1,
      newRepetitions: 1,
      nextReviewAt,
      intervalUnit: 'days',
      lapseCount,
      isLeech: this.checkLeech(lapseCount, leechThreshold),
    };
  }
}

export const flashcardSpacedRepetitionService = new FlashcardSpacedRepetitionService();
