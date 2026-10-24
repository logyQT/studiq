import type {
  CalculateNextReviewInput,
  CalculateNextReviewOutput,
  Rating,
} from '@studiq/server/models/flashcard-spaced-repetition.model';

export class FlashcardSpacedRepetitionService {
  private readonly MAX_INTERVAL_DAYS = 365;
  private readonly FUZZ_MIN_INTERVAL_DAYS = 3;

  /**
   * Days of slack around a review-state interval that the caller may shift
   * next_review_at within (load balancing picks the least-crowded day in
   * this window instead of pure random fuzz). Zero below
   * FUZZ_MIN_INTERVAL_DAYS — fuzzing very short intervals risks moving a
   * review to today/yesterday. 5% of the interval, floor 1, cap 3 days,
   * mirroring the fuzz ranges other SM-2 implementations use to avoid
   * cards scheduled together clumping onto the same day indefinitely.
   */
  getFuzzRangeDays(intervalDays: number): number {
    if (intervalDays < this.FUZZ_MIN_INTERVAL_DAYS) return 0;
    return Math.max(1, Math.min(Math.round(intervalDays * 0.05), 3));
  }

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

  /**
   * Canonical SM-2 easiness-factor update, shared by every scheduling path so a
   * grade moves EF whether the card is new, learning, relearning or in review.
   * Clamped at 1.3 and rounded to 2 dp so stored values stay comparable across
   * paths (issue #340: EF used to be recalculated only for review cards).
   */
  private applyEasinessFactor(easinessFactor: number, rating: Rating): number {
    const quality = this.mapToQuality(rating);
    const next = easinessFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    return Math.round(Math.max(1.3, next) * 100) / 100;
  }

  /**
   * A brand-new card is by definition at step 0 of the learning ladder, so it
   * reuses the same "advance or graduate" logic as every later learning grade
   * instead of keeping a second copy that can drift (issue #340: Good on a new
   * card stayed on step 0 because this path ignored the rating).
   */
  private handleNew(input: CalculateNextReviewInput): CalculateNextReviewOutput {
    return this.handleLearningStep('learning', { ...input, currentStep: 0 });
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
          newEasinessFactor: this.applyEasinessFactor(easinessFactor, rating),
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
          newEasinessFactor: this.applyEasinessFactor(easinessFactor, rating),
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
          return this.graduateToReview(easinessFactor, lapseCount, leechThreshold, rating);
        }
        const nextStep = currentStep + 1;
        const delay = learningSteps[nextStep] ?? 10;
        return {
          learningState: currentState,
          learningStep: nextStep,
          newEasinessFactor: this.applyEasinessFactor(easinessFactor, rating),
          newInterval: delay,
          newRepetitions: 0,
          nextReviewAt: scheduleMinutes(delay),
          intervalUnit: 'minutes',
          lapseCount,
          isLeech: this.checkLeech(lapseCount, leechThreshold),
        };
      }
      case 4: {
        return this.graduateToReview(easinessFactor, lapseCount, leechThreshold, rating);
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
        newEasinessFactor: this.applyEasinessFactor(input.easinessFactor, input.rating),
        newInterval: delay,
        newRepetitions: input.repetitions,
        nextReviewAt,
        intervalUnit: 'minutes',
        lapseCount: newLapseCount,
        isLeech: this.checkLeech(newLapseCount, input.leechThreshold),
      };
    }

    let newInterval = input.interval;
    const newRepetitions = input.repetitions + 1;

    // Interval maths uses the pre-update factor, then EF moves — SM-2 ordering.
    if (newRepetitions === 1) {
      newInterval = 1;
    } else if (newRepetitions === 2) {
      newInterval = 6;
    } else {
      newInterval = Math.round(newInterval * input.easinessFactor);
    }

    if (newInterval > this.MAX_INTERVAL_DAYS) newInterval = this.MAX_INTERVAL_DAYS;

    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + newInterval);
    nextReviewAt.setHours(0, 0, 0, 0);

    return {
      learningState: 'review',
      learningStep: 0,
      newEasinessFactor: this.applyEasinessFactor(input.easinessFactor, input.rating),
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
    rating: Rating,
  ): CalculateNextReviewOutput {
    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + 1);
    nextReviewAt.setHours(0, 0, 0, 0);

    return {
      learningState: 'review',
      learningStep: 0,
      newEasinessFactor: this.applyEasinessFactor(easinessFactor, rating),
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
