export interface Deck {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
  created_by: string;
  updated_at?: string;
  suspended?: boolean;
}

export interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
  created_by: string;
  created_at?: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  created_by: string;
  flashcard_topic_assignments?: Array<{ topic_id: string }>;
  flashcard_deck_assignments?: Array<{ deck_id: string }>;
}
