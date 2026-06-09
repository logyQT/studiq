import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { flashcardKeys } from '@/lib/query-keys';

export interface Deck {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
}

export interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  flashcard_topic_assignments?: Array<{ topic_id: string }>;
  flashcard_deck_assignments?: Array<{ deck_id: string }>;
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed`);
  const json = await res.json();
  return json.data as T;
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} failed`);
  const json = await res.json();
  return json.data as T;
}

async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${url} failed`);
  const json = await res.json();
  return json.data as T;
}

async function apiDelete(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${url} failed`);
}

// ─── Decks ───────────────────────────────────────────

export function useDecks() {
  return useQuery({
    queryKey: flashcardKeys.decks.all,
    queryFn: () => apiGet<Deck[]>('/api/v1/flashcards/decks'),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
}

export function useDeck(id: string) {
  return useQuery({
    queryKey: flashcardKeys.decks.detail(id),
    queryFn: () => apiGet<Deck>(`/api/v1/flashcards/decks/${id}`),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    enabled: !!id,
  });
}

export function useCreateDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      apiPost<Deck>('/api/v1/flashcards/decks', data),
    onSuccess: (newDeck) => {
      queryClient.setQueryData<Deck[]>(flashcardKeys.decks.all, (old) =>
        [{ ...newDeck, flashcard_count: 0 }, ...(old ?? [])],
      );
    },
  });
}

export function useUpdateDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string; description?: string }) =>
      apiPut<Deck>(`/api/v1/flashcards/decks/${id}`, data),
    onMutate: async ({ id, ...data }) => {
      await queryClient.cancelQueries({ queryKey: flashcardKeys.decks.all });
      const previous = queryClient.getQueryData<Deck[]>(flashcardKeys.decks.all);
      queryClient.setQueryData<Deck[]>(flashcardKeys.decks.all, (old) =>
        old?.map((d) => (d.id === id ? { ...d, ...data } : d)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(flashcardKeys.decks.all, context?.previous);
    },
  });
}

export function useDeleteDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/flashcards/decks/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: flashcardKeys.decks.all });
      const previous = queryClient.getQueryData<Deck[]>(flashcardKeys.decks.all);
      queryClient.setQueryData<Deck[]>(flashcardKeys.decks.all, (old) =>
        old?.filter((d) => d.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      queryClient.setQueryData(flashcardKeys.decks.all, context?.previous);
    },
  });
}

// ─── Flashcards ──────────────────────────────────────

function flashcardListKey(deckId: string) {
  return flashcardKeys.list({ deckIds: [deckId] });
}

export function useDeckFlashcards(deckId: string) {
  return useQuery({
    queryKey: flashcardListKey(deckId),
    queryFn: () => apiGet<Flashcard[]>(`/api/v1/flashcards?deckIds=${deckId}`),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    enabled: !!deckId,
  });
}

export function useAllFlashcards() {
  return useQuery({
    queryKey: flashcardKeys.list({}),
    queryFn: () => apiGet<Flashcard[]>('/api/v1/flashcards'),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
}

export function useCreateFlashcard(deckId: string) {
  const queryClient = useQueryClient();
  const queryKey = flashcardListKey(deckId);
  return useMutation({
    mutationFn: (data: { front: string; back: string; topicIds?: string[] }) =>
      apiPost<Flashcard>('/api/v1/flashcards', { ...data, deckId }),
    onSuccess: (newFlashcard) => {
      queryClient.setQueryData<Flashcard[]>(queryKey, (old) =>
        [newFlashcard, ...(old ?? [])],
      );
    },
  });
}

export function useUpdateFlashcard(deckId: string) {
  const queryClient = useQueryClient();
  const queryKey = flashcardListKey(deckId);
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; front: string; back: string; topicIds: string[] }) =>
      apiPut<Flashcard>(`/api/v1/flashcards/${id}`, data),
    onMutate: async ({ id, ...data }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Flashcard[]>(queryKey);
      queryClient.setQueryData<Flashcard[]>(queryKey, (old) =>
        old?.map((fc) => (fc.id === id ? { ...fc, ...data } : fc)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
    },
  });
}

export function useDeleteFlashcard(deckId: string) {
  const queryClient = useQueryClient();
  const queryKey = flashcardListKey(deckId);
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/flashcards/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Flashcard[]>(queryKey);
      queryClient.setQueryData<Flashcard[]>(queryKey, (old) =>
        old?.filter((fc) => fc.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
    },
  });
}

// ─── Practice ────────────────────────────────────────

export function usePracticeDueCount() {
  return useQuery({
    queryKey: [...flashcardKeys.all, 'practice', 'due', 'count'],
    queryFn: () => apiGet<{ count: number }>('/api/v1/flashcards/practice/due/count'),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
}

// ─── Topics ──────────────────────────────────────────

export function useTopics() {
  return useQuery({
    queryKey: flashcardKeys.topics.all,
    queryFn: () => apiGet<Topic[]>('/api/v1/flashcards/topics'),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
}

export function useCreateTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string }) =>
      apiPost<Topic>('/api/v1/flashcards/topics', data),
    onSuccess: (newTopic) => {
      queryClient.setQueryData<Topic[]>(flashcardKeys.topics.all, (old) =>
        [{ ...newTopic, flashcard_count: 0 }, ...(old ?? [])],
      );
    },
  });
}

export function useUpdateTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string }) =>
      apiPut<Topic>(`/api/v1/flashcards/topics/${id}`, data),
    onMutate: async ({ id, ...data }) => {
      await queryClient.cancelQueries({ queryKey: flashcardKeys.topics.all });
      const previous = queryClient.getQueryData<Topic[]>(flashcardKeys.topics.all);
      queryClient.setQueryData<Topic[]>(flashcardKeys.topics.all, (old) =>
        old?.map((t) => (t.id === id ? { ...t, ...data } : t)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(flashcardKeys.topics.all, context?.previous);
    },
  });
}

export function useDeleteTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/flashcards/topics/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: flashcardKeys.topics.all });
      const previous = queryClient.getQueryData<Topic[]>(flashcardKeys.topics.all);
      queryClient.setQueryData<Topic[]>(flashcardKeys.topics.all, (old) =>
        old?.filter((t) => t.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      queryClient.setQueryData(flashcardKeys.topics.all, context?.previous);
    },
  });
}
