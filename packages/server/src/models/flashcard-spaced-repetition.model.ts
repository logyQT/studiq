export type LearningState = 'new' | 'learning' | 'review' | 'relearning';
export type Rating = 1 | 2 | 3 | 4;
export type IntervalUnit = 'minutes' | 'days';

export interface CalculateNextReviewInput {
  learningState: LearningState;
  currentStep: number;
  learningSteps: number[];
  rating: Rating;
  easinessFactor: number;
  interval: number;
  repetitions: number;
  lapseCount: number;
  leechThreshold: number;
}

export interface CalculateNextReviewOutput {
  learningState: Exclude<LearningState, 'new'>;
  learningStep: number;
  newEasinessFactor: number;
  newInterval: number;
  newRepetitions: number;
  nextReviewAt: Date;
  intervalUnit: IntervalUnit;
  lapseCount: number;
  isLeech: boolean;
}
