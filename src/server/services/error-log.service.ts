import { log } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/service';

export interface ErrorLogContext {
  url?: string;
  method?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface ErrorLogEntry {
  id: string;
  error_code: string;
  message: string;
  stack_trace: string | null;
  url: string | null;
  method: string | null;
  user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ErrorLogListFilters {
  search?: string;
  errorCode?: string;
  limit?: number;
  offset?: number;
}

export class ErrorLogService {
  async logError(
    error: unknown,
    errorCode: string,
    context?: ErrorLogContext,
  ): Promise<string> {
    const supabase = createServiceClient();

    const message = error instanceof Error ? error.message : String(error);
    const stackTrace = error instanceof Error ? error.stack ?? null : null;

    const { data, error: insertError } = await supabase
      .from('error_logs')
      .insert({
        error_code: errorCode,
        message,
        stack_trace: stackTrace,
        url: context?.url ?? null,
        method: context?.method ?? null,
        user_id: context?.userId ?? null,
        metadata: context?.metadata ?? null,
      })
      .select('id')
      .single();

    if (insertError) {
      log.system.error('Failed to persist error log', { metadata: { insertError } });
    }

    return data?.id ?? 'unknown';
  }

  async getById(id: string): Promise<ErrorLogEntry | null> {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('error_logs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return null;

    return data as ErrorLogEntry;
  }

  async list(filters?: ErrorLogListFilters): Promise<{ data: ErrorLogEntry[]; count: number }> {
    const supabase = createServiceClient();
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    let query = supabase
      .from('error_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters?.errorCode) {
      query = query.eq('error_code', filters.errorCode);
    }

    if (filters?.search) {
      query = query.or(
        `id.eq.${filters.search},message.ilike.%${filters.search}%,stack_trace.ilike.%${filters.search}%`,
      );
    }

    const { data, error, count } = await query;

    if (error) {
      log.system.error('Failed to list error logs', { metadata: { error } });
      return { data: [], count: 0 };
    }

    return { data: (data as ErrorLogEntry[]) ?? [], count: count ?? 0 };
  }
}

export const errorLogService = new ErrorLogService();
