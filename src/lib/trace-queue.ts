import { agentTraceService } from '@/server/services/agent-trace.service';

type QueuedEvent = {
  conversationId?: string;
  agentName: string;
  iteration?: number;
  eventType:
    | 'step'
    | 'tool_call'
    | 'tool_result'
    | 'llm_request'
    | 'llm_response'
    | 'error'
    | 'retry';
  label: string;
  data: Record<string, unknown>;
};

export function enqueueTrace(event: QueuedEvent): void {
  agentTraceService.log(event).catch(() => {});
}
