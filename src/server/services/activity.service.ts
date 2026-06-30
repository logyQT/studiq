import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type {
  ActivityQuery,
  ClassActivityResponse,
  DailyActivityPoint,
  MetricComparison,
  QuizActivityItem,
  StudentActivityRow,
} from '@/server/models/activity.model';

export class ActivityService {
  async getClassActivity(
    ctx: RequestContext,
    query: ActivityQuery,
  ): Promise<ClassActivityResponse> {
    const supabase = await createClient();
    const orgId = ctx.activeOrgId;

    if (!orgId) throw new AppError('FORBIDDEN');

    const rangeDays = query.range === '7d' ? 7 : query.range === '30d' ? 30 : 90;
    const now = new Date();
    const rangeStart = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
    const prevRangeStart = new Date(rangeStart.getTime() - rangeDays * 24 * 60 * 60 * 1000);

    const { data: studentMembers, error: memberError } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('role', 'student');

    if (memberError) throw mapSupabaseError(memberError);
    const studentIds = (studentMembers || []).map((m: { user_id: string }) => m.user_id);
    if (studentIds.length === 0) {
      return { summary: this.emptySummary(), dailyActivity: [], students: [], quizzes: [] };
    }

    const studentIdSet = studentIds;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', studentIds);

    const profileMap = new Map(
      (profiles || []).map((p: { id: string; email: string; full_name: string | null }) => [
        p.id,
        p,
      ]),
    );

    const { data: activity } = await supabase
      .from('user_daily_activity')
      .select(
        'user_id, date, reviews_count, reviews_correct, quizzes_count, quizzes_score, quizzes_total',
      )
      .in('user_id', studentIds)
      .gte('date', prevRangeStart.toISOString().split('T')[0])
      .lte('date', now.toISOString().split('T')[0]);

    const rows = (activity || []) as Array<{
      user_id: string;
      date: string;
      reviews_count: number;
      reviews_correct: number;
      quizzes_count: number;
      quizzes_score: number;
      quizzes_total: number;
    }>;

    const currentRows = rows.filter((r) => new Date(r.date) >= rangeStart);
    const previousRows = rows.filter(
      (r) => new Date(r.date) >= prevRangeStart && new Date(r.date) < rangeStart,
    );

    const summary = this.computeSummary(currentRows, previousRows, studentIds.length);

    const dailyActivity = this.computeDailyActivity(currentRows, rangeDays);

    const students = await this.computeStudentActivity(
      supabase,
      studentIdSet,
      profileMap,
      currentRows,
      rangeStart,
    );

    const quizzes = await this.computeQuizActivity(supabase, studentIds, rangeStart);

    return { summary, dailyActivity, students, quizzes };
  }

  private emptySummary() {
    return {
      activeStudents: { current: 0, previous: 0 },
      totalPractices: { current: 0, previous: 0 },
      avgAccuracy: { current: 0, previous: 0 },
      totalQuizzes: { current: 0, previous: 0 },
    };
  }

  private computeSummary(
    currentRows: Array<{
      user_id: string;
      reviews_count: number;
      reviews_correct: number;
      quizzes_count: number;
    }>,
    previousRows: Array<{
      user_id: string;
      reviews_count: number;
      reviews_correct: number;
      quizzes_count: number;
    }>,
    _totalStudents: number,
  ): {
    activeStudents: MetricComparison;
    totalPractices: MetricComparison;
    avgAccuracy: MetricComparison;
    totalQuizzes: MetricComparison;
  } {
    const currentActive = new Set(currentRows.map((r) => r.user_id)).size;
    const previousActive = new Set(previousRows.map((r) => r.user_id)).size;

    const currentPractices = currentRows.reduce((s, r) => s + r.reviews_count, 0);
    const previousPractices = previousRows.reduce((s, r) => s + r.reviews_count, 0);

    const currentCorrect = currentRows.reduce((s, r) => s + r.reviews_correct, 0);
    const previousCorrect = previousRows.reduce((s, r) => s + r.reviews_correct, 0);

    const currentAccuracy =
      currentPractices > 0 ? Math.round((currentCorrect / currentPractices) * 100) : 0;
    const previousAccuracy =
      previousPractices > 0 ? Math.round((previousCorrect / previousPractices) * 100) : 0;

    const currentQuizzes = currentRows.reduce((s, r) => s + r.quizzes_count, 0);
    const previousQuizzes = previousRows.reduce((s, r) => s + r.quizzes_count, 0);

    return {
      activeStudents: { current: currentActive, previous: previousActive },
      totalPractices: { current: currentPractices, previous: previousPractices },
      avgAccuracy: { current: currentAccuracy, previous: previousAccuracy },
      totalQuizzes: { current: currentQuizzes, previous: previousQuizzes },
    };
  }

  private computeDailyActivity(
    rows: Array<{ user_id: string; date: string; reviews_count: number }>,
    rangeDays: number,
  ): DailyActivityPoint[] {
    const byDate = new Map<string, { reviews: number; users: Set<string> }>();

    for (const r of rows) {
      const entry = byDate.get(r.date) || { reviews: 0, users: new Set<string>() };
      entry.reviews += r.reviews_count;
      entry.users.add(r.user_id);
      byDate.set(r.date, entry);
    }

    const result: DailyActivityPoint[] = [];
    for (let i = rangeDays - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const entry = byDate.get(date);
      result.push({
        date,
        reviews: entry?.reviews ?? 0,
        activeStudents: entry?.users.size ?? 0,
      });
    }
    return result;
  }

  private async computeStudentActivity(
    supabase: Awaited<ReturnType<typeof createClient>>,
    studentIds: string[],
    profileMap: Map<string, { id: string; email: string; full_name: string | null }>,
    currentRows: Array<{
      user_id: string;
      reviews_count: number;
      reviews_correct: number;
      quizzes_count: number;
    }>,
    _rangeStart: Date,
  ): Promise<StudentActivityRow[]> {
    const { data: lastPractice } = await supabase
      .from('flashcard_practice')
      .select('user_id, practiced_at')
      .in('user_id', studentIds)
      .order('practiced_at', { ascending: false });

    const lastActiveMap = new Map<string, string>();
    for (const row of (lastPractice || []) as Array<{ user_id: string; practiced_at: string }>) {
      if (!lastActiveMap.has(row.user_id)) {
        lastActiveMap.set(row.user_id, row.practiced_at);
      }
    }

    const studentActivityMap = new Map<
      string,
      { practices: number; correct: number; quizzes: number }
    >();
    for (const r of currentRows) {
      const entry = studentActivityMap.get(r.user_id) || { practices: 0, correct: 0, quizzes: 0 };
      entry.practices += r.reviews_count;
      entry.correct += r.reviews_correct;
      entry.quizzes += r.quizzes_count;
      studentActivityMap.set(r.user_id, entry);
    }

    const _dayCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    return studentIds.map((id) => {
      const profile = profileMap.get(id);
      const lastActive = lastActiveMap.get(id) ?? null;
      const activity = studentActivityMap.get(id) || { practices: 0, correct: 0, quizzes: 0 };
      const accuracy =
        activity.practices > 0 ? Math.round((activity.correct / activity.practices) * 100) : null;

      let status: 'active' | 'recent' | 'check_in';
      if (!lastActive) {
        status = 'check_in';
      } else {
        const lastDate = new Date(lastActive);
        const diffDays = (Date.now() - lastDate.getTime()) / (24 * 60 * 60 * 1000);
        if (diffDays < 1) status = 'active';
        else if (diffDays < 7) status = 'recent';
        else status = 'check_in';
      }

      return {
        id,
        name: profile?.full_name ?? profile?.email.split('@')[0] ?? 'Unknown',
        email: profile?.email ?? '',
        lastActive,
        practices7d: activity.practices,
        accuracy7d: accuracy,
        quizzes7d: activity.quizzes,
        status,
      };
    });
  }

  private async computeQuizActivity(
    supabase: Awaited<ReturnType<typeof createClient>>,
    studentIds: string[],
    rangeStart: Date,
  ): Promise<QuizActivityItem[]> {
    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select('score, total_questions, config, completed_at')
      .in('user_id', studentIds)
      .gte('completed_at', rangeStart.toISOString())
      .not('completed_at', 'is', null);

    const quizMap = new Map<string, { totalScore: number; count: number }>();

    for (const row of (attempts || []) as Array<{
      score: number;
      config: Record<string, unknown> | null;
    }>) {
      const config = row.config as Record<string, unknown> | null;
      const difficulty = (config?.difficulty as string) || 'mixed';
      const key = difficulty;
      const entry = quizMap.get(key) || { totalScore: 0, count: 0 };
      entry.totalScore += row.score;
      entry.count += 1;
      quizMap.set(key, entry);
    }

    const difficulties = ['easy', 'medium', 'hard', 'mixed'];
    return difficulties.map((difficulty) => {
      const entry = quizMap.get(difficulty);
      return {
        difficulty,
        attempts: entry?.count ?? 0,
        avgScore: entry && entry.count > 0 ? Math.round(entry.totalScore / entry.count) : 0,
      };
    });
  }
}

export const activityService = new ActivityService();
