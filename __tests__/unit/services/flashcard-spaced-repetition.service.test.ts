import { describe, it, expect } from 'vitest';
import { flashcardSpacedRepetitionService } from '@/server/services/flashcard-spaced-repetition.service';
import type { Rating } from '@/server/models';

const reviewInput = (overrides: Partial<{
  learningState: 'new' | 'learning' | 'review' | 'relearning';
  currentStep: number;
  learningSteps: number[];
  rating: Rating;
  easinessFactor: number;
  interval: number;
  repetitions: number;
  lapseCount: number;
  leechThreshold: number;
}> = {}) => ({
  learningState: 'review' as const,
  currentStep: 0,
  learningSteps: [1, 10],
  rating: 3 as Rating,
  easinessFactor: 2.5,
  interval: 0,
  repetitions: 0,
  lapseCount: 0,
  leechThreshold: 8,
  ...overrides,
});

describe('FlashcardSpacedRepetitionService', () => {
  describe('calculateNextReview - review state (existing SM-2)', () => {
    it('correct first review with rating 4 (Easy): interval=1, EF increases', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        rating: 4, easinessFactor: 2.5, interval: 0, repetitions: 0,
      }));

      expect(result.learningState).toBe('review');
      expect(result.newRepetitions).toBe(1);
      expect(result.newInterval).toBe(1);
      expect(result.newEasinessFactor).toBe(2.6);
    });

    it('correct second review: interval=6', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        rating: 4, easinessFactor: 2.5, interval: 1, repetitions: 1,
      }));

      expect(result.newRepetitions).toBe(2);
      expect(result.newInterval).toBe(6);
    });

    it('correct third review: interval = prev * EF', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        rating: 4, easinessFactor: 2.5, interval: 6, repetitions: 2,
      }));

      expect(result.newRepetitions).toBe(3);
      expect(result.newInterval).toBe(Math.round(6 * 2.5));
    });

    it('Again on review: lapse into relearning at step 0', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'review', rating: 1, lapseCount: 2,
      }));

      expect(result.learningState).toBe('relearning');
      expect(result.learningStep).toBe(0);
      expect(result.lapseCount).toBe(3);
      expect(result.intervalUnit).toBe('minutes');
    });

    it('EF never goes below 1.3', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        rating: 3, easinessFactor: 1.3, interval: 1, repetitions: 0,
      }));

      expect(result.newEasinessFactor).toBeGreaterThanOrEqual(1.3);
    });

    it('nextReviewAt is in the future for review', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        rating: 4, easinessFactor: 2.5, interval: 1, repetitions: 1,
      }));

      expect(result.nextReviewAt.getTime()).toBeGreaterThanOrEqual(
        new Date().setHours(0, 0, 0, 0),
      );
    });
  });

  describe('calculateNextReview - new state', () => {
    it('Again/Hard/Good on new card: starts learning at step 0', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'new', rating: 3,
      }));

      expect(result.learningState).toBe('learning');
      expect(result.learningStep).toBe(0);
      expect(result.intervalUnit).toBe('minutes');
      expect(result.newInterval).toBe(1);
    });

    it('Easy on new card: graduates to review immediately', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'new', rating: 4,
      }));

      expect(result.learningState).toBe('review');
      expect(result.newInterval).toBe(1);
      expect(result.intervalUnit).toBe('days');
      expect(result.newRepetitions).toBe(1);
    });
  });

  describe('calculateNextReview - learning state', () => {
    it('Again resets to step 0', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'learning', currentStep: 1, rating: 1,
      }));

      expect(result.learningState).toBe('learning');
      expect(result.learningStep).toBe(0);
      expect(result.newInterval).toBe(1);
    });

    it('Hard stays on same step with 1.5× delay', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'learning', currentStep: 0, rating: 2,
      }));

      expect(result.learningState).toBe('learning');
      expect(result.learningStep).toBe(0);
      expect(result.newInterval).toBe(Math.round(1 * 1.5));
    });

    it('Good advances to next step', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'learning', currentStep: 0, rating: 3, learningSteps: [1, 10],
      }));

      expect(result.learningState).toBe('learning');
      expect(result.learningStep).toBe(1);
      expect(result.newInterval).toBe(10);
    });

    it('Good on last step graduates to review', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'learning', currentStep: 1, rating: 3, learningSteps: [1, 10],
      }));

      expect(result.learningState).toBe('review');
      expect(result.learningStep).toBe(0);
      expect(result.newInterval).toBe(1);
      expect(result.intervalUnit).toBe('days');
    });

    it('Easy graduates to review', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'learning', currentStep: 0, rating: 4,
      }));

      expect(result.learningState).toBe('review');
      expect(result.learningStep).toBe(0);
      expect(result.newInterval).toBe(1);
      expect(result.intervalUnit).toBe('days');
    });
  });

  describe('calculateNextReview - relearning state', () => {
    it('Good on last relearning step graduates to review', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'relearning', currentStep: 1, rating: 3, learningSteps: [1, 10],
      }));

      expect(result.learningState).toBe('review');
      expect(result.learningStep).toBe(0);
      expect(result.intervalUnit).toBe('days');
    });

    it('Again resets to step 0 in relearning', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'relearning', currentStep: 1, rating: 1,
      }));

      expect(result.learningState).toBe('relearning');
      expect(result.learningStep).toBe(0);
    });
  });

  describe('leech detection', () => {
    it('returns isLeech=true when lapseCount >= threshold', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'review', rating: 1, lapseCount: 7, leechThreshold: 8,
      }));

      expect(result.isLeech).toBe(true);
      expect(result.lapseCount).toBe(8);
    });

    it('returns isLeech=false when below threshold', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview(reviewInput({
        learningState: 'review', rating: 3, lapseCount: 3, leechThreshold: 8,
      }));

      expect(result.isLeech).toBe(false);
    });

    it('checkLeech returns true when lapseCount >= threshold', () => {
      expect(flashcardSpacedRepetitionService.checkLeech(8, 8)).toBe(true);
      expect(flashcardSpacedRepetitionService.checkLeech(9, 8)).toBe(true);
    });

    it('checkLeech returns false when lapseCount < threshold', () => {
      expect(flashcardSpacedRepetitionService.checkLeech(7, 8)).toBe(false);
      expect(flashcardSpacedRepetitionService.checkLeech(0, 8)).toBe(false);
    });
  });

  describe('mapToQuality', () => {
    it('maps rating 1 (Again) to quality 0', () => {
      expect(flashcardSpacedRepetitionService.mapToQuality(1)).toBe(0);
    });

    it('maps rating 2 (Hard) to quality 2', () => {
      expect(flashcardSpacedRepetitionService.mapToQuality(2)).toBe(2);
    });

    it('maps rating 3 (Good) to quality 3', () => {
      expect(flashcardSpacedRepetitionService.mapToQuality(3)).toBe(3);
    });

    it('maps rating 4 (Easy) to quality 5', () => {
      expect(flashcardSpacedRepetitionService.mapToQuality(4)).toBe(5);
    });
  });
});
