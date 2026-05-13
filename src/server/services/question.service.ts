import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type { CreateQuestionInput, UpdateQuestionInput } from '@/server/models';

export class QuestionService {
  async create(data: CreateQuestionInput, userId: string) {
    const supabase = await createClient();

    const { data: question, error: qError } = await supabase
      .from('questions')
      .insert({
        subject_id: data.subjectId ?? null,
        type: data.type,
        content: data.content,
        explanation: data.explanation ?? null,
        difficulty: data.difficulty,
        created_by: userId,
      })
      .select()
      .single();

    if (qError || !question) throw new AppError('INTERNAL_SERVER');

    const answersToInsert = data.answers.map((a, i) => ({
      question_id: question.id,
      content: a.content,
      is_correct: a.isCorrect,
      order_index: a.orderIndex ?? i,
    }));

    const { error: aError } = await supabase.from('question_answers').insert(answersToInsert);
    if (aError) throw new AppError('INTERNAL_SERVER');

    return {
      ...question,
      question_answers: data.answers.map((a, i) => ({
        id: '',
        question_id: question.id,
        content: a.content,
        is_correct: a.isCorrect,
        order_index: a.orderIndex ?? i,
        created_at: new Date().toISOString(),
      })),
    };
  }

  async list(filters?: { subjectId?: string; type?: string; difficulty?: string }) {
    const supabase = await createClient();
    let query = supabase
      .from('questions')
      .select('*, question_answers(*)')
      .order('created_at', { ascending: false });

    if (filters?.subjectId) query = query.eq('subject_id', filters.subjectId);
    if (filters?.type) query = query.eq('type', filters.type);
    if (filters?.difficulty) query = query.eq('difficulty', filters.difficulty);

    const { data, error } = await query;
    if (error) throw new AppError('INTERNAL_SERVER');
    return data;
  }

  async getById(id: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('questions')
      .select('*, question_answers(*)')
      .eq('id', id)
      .single();

    if (error || !data || (Array.isArray(data) && data.length === 0)) throw new AppError('NOT_FOUND');
    return data;
  }

  async update(id: string, data: UpdateQuestionInput, userId: string) {
    const supabase = await createClient();

    const updateFields: Record<string, unknown> = {};
    if (data.subjectId !== undefined) updateFields.subject_id = data.subjectId;
    if (data.type) updateFields.type = data.type;
    if (data.content) updateFields.content = data.content;
    if (data.explanation !== undefined) updateFields.explanation = data.explanation;
    if (data.difficulty) updateFields.difficulty = data.difficulty;

    const { data: question, error: qError } = await supabase
      .from('questions')
      .update(updateFields)
      .eq('id', id)
      .eq('created_by', userId)
      .select()
      .single();

    if (qError && qError.code !== 'PGRST116') throw new AppError('INTERNAL_SERVER');
    if (!question || (Array.isArray(question) && question.length === 0)) throw new AppError('FORBIDDEN');

    if (data.answers) {
      await supabase.from('question_answers').delete().eq('question_id', id);
      const answersToInsert = data.answers.map((a, i) => ({
        question_id: id,
        content: a.content,
        is_correct: a.isCorrect,
        order_index: a.orderIndex ?? i,
      }));
      await supabase.from('question_answers').insert(answersToInsert);
    }

    return this.getById(id);
  }

  async delete(id: string, userId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id)
      .eq('created_by', userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw new AppError('INTERNAL_SERVER');
    if (!data || (Array.isArray(data) && data.length === 0)) throw new AppError('FORBIDDEN');
  }

  async getStatsBySubject(subjectId: string) {
    const supabase = await createClient();

    const { data: questions } = await supabase
      .from('questions')
      .select('id, type, difficulty')
      .eq('subject_id', subjectId);

    const { data: attempts } = await supabase
      .from('quiz_answers')
      .select('question_id, is_correct')
      .in(
        'question_id',
        questions?.map((q) => q.id) ?? [],
      );

    const correctMap = new Map<string, { correct: number; total: number }>();
    attempts?.forEach((a) => {
      const entry = correctMap.get(a.question_id) || { correct: 0, total: 0 };
      entry.total++;
      if (a.is_correct) entry.correct++;
      correctMap.set(a.question_id, entry);
    });

    const problematicQuestions = questions
      ?.map((q) => ({
        ...q,
        stats: correctMap.get(q.id),
        correctRate: correctMap.get(q.id)
          ? correctMap.get(q.id)!.correct / correctMap.get(q.id)!.total
          : null,
      }))
      .filter((q) => q.stats && q.correctRate !== null && q.correctRate < 0.5)
      .sort((a, b) => (a.correctRate ?? 1) - (b.correctRate ?? 1));

    return {
      totalQuestions: questions?.length ?? 0,
      byType: questions?.reduce(
        (acc, q) => {
          acc[q.type] = (acc[q.type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
      byDifficulty: questions?.reduce(
        (acc, q) => {
          acc[q.difficulty] = (acc[q.difficulty] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
      problematicQuestions: problematicQuestions ?? [],
    };
  }
}

export const questionService = new QuestionService();
