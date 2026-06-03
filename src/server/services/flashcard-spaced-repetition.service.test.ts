import { describe, it, expect } from 'vitest';
import { flashcardSpacedRepetitionService } from './flashcard-spaced-repetition.service';

describe('FlashcardSpacedRepetitionService', () => {
  describe('calculateNextReview', () => {
    it('correct first review with confidence 4: maps to quality 4, EF unchanged', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview({
        wasCorrect: true,
        confidenceLevel: 4,
        currentEF: 2.5,
        currentInterval: 0,
        currentRepetitions: 0,
      });

      expect(result.newRepetitions).toBe(1);
      expect(result.newInterval).toBe(1);
      expect(result.newEF).toBe(2.5);
    });

    it('correct second review: interval=6', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview({
        wasCorrect: true,
        confidenceLevel: 5,
        currentEF: 2.5,
        currentInterval: 1,
        currentRepetitions: 1,
      });

      expect(result.newRepetitions).toBe(2);
      expect(result.newInterval).toBe(6);
    });

    it('correct third review: interval = prev * EF', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview({
        wasCorrect: true,
        confidenceLevel: 4,
        currentEF: 2.5,
        currentInterval: 6,
        currentRepetitions: 2,
      });

      expect(result.newRepetitions).toBe(3);
      expect(result.newInterval).toBe(Math.round(6 * 2.5));
    });

    it('incorrect answer: resets repetitions and interval=1', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview({
        wasCorrect: false,
        currentEF: 2.5,
        currentInterval: 10,
        currentRepetitions: 5,
      });

      expect(result.newRepetitions).toBe(0);
      expect(result.newInterval).toBe(1);
    });

    it('EF never goes below 1.3', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview({
        wasCorrect: true,
        confidenceLevel: 3,
        currentEF: 1.3,
        currentInterval: 1,
        currentRepetitions: 0,
      });

      expect(result.newEF).toBeGreaterThanOrEqual(1.3);
    });

    it('correct without confidenceLevel defaults to quality 4 (EF unchanged)', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview({
        wasCorrect: true,
        currentEF: 2.5,
        currentInterval: 0,
        currentRepetitions: 0,
      });

      expect(result.newInterval).toBe(1);
      expect(result.newEF).toBe(2.5);
    });

    it('nextReviewAt is in the future', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview({
        wasCorrect: true,
        confidenceLevel: 5,
        currentEF: 2.5,
        currentInterval: 1,
        currentRepetitions: 1,
      });

      expect(result.nextReviewAt.getTime()).toBeGreaterThanOrEqual(
        new Date().setHours(0, 0, 0, 0),
      );
    });
  });

  describe('quality mapping', () => {
    it('incorrect + no confidence = quality 0 => EF unchanged (SM-2 standard)', () => {
      const startingEF = 2.5;
      const result = flashcardSpacedRepetitionService.calculateNextReview({
        wasCorrect: false,
        currentEF: startingEF,
        currentInterval: 1,
        currentRepetitions: 1,
      });

      expect(result.newEF).toBe(startingEF);
      expect(result.newRepetitions).toBe(0);
    });

    it('incorrect + confidence 2 = quality 1 => EF unchanged', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview({
        wasCorrect: false,
        confidenceLevel: 2,
        currentEF: 2.5,
        currentInterval: 1,
        currentRepetitions: 1,
      });

      expect(result.newEF).toBe(2.5);
      expect(result.newRepetitions).toBe(0);
    });

    it('correct + confidence 1 = quality 3 => EF decreases slightly', () => {
      const result = flashcardSpacedRepetitionService.calculateNextReview({
        wasCorrect: true,
        confidenceLevel: 1,
        currentEF: 2.5,
        currentInterval: 0,
        currentRepetitions: 0,
      });

      expect(result.newEF).toBeLessThan(2.5);
      expect(result.newRepetitions).toBe(1);
    });
  });
});
