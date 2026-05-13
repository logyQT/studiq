export type TeacherStatsResponse = {
  totalQuestions: number;
  totalFlashcards: number;
  subject?: {
    totalQuestions: number;
    byType: Record<string, number>;
    byDifficulty: Record<string, number>;
    problematicQuestions: unknown[];
  };
};

export type StudentStatsResponse = {
  totalQuizzes: number;
  avgScore: number;
  totalQuestionsCreated: number;
  flashcardsPracticed: number;
  flashcardAccuracy: number;
  attemptsOverTime: {
    date: string;
    score: number;
    total: number;
    percentage: number;
  }[];
};
