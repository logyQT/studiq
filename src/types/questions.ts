export interface QuestionBank {
  id: string;
  name: string;
  description: string | null;
  question_count: number;
  created_by: string;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuestionAnswer {
  id: string;
  question_id: string;
  content: string;
  is_correct: boolean;
  order_index: number;
}

export interface Question {
  id: string;
  organization_id: string | null;
  created_by: string;
  type: 'mcq' | 'true_false' | 'open';
  content: string;
  explanation: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  created_at: string;
  updated_at: string;
  question_answers: QuestionAnswer[];
  topics?: Array<{ id: string; name: string }>;
}
