import { conversationStorage } from '@studiq/server/lib/conversation-context';
import { enqueueTrace } from '@studiq/server/lib/trace-queue';
import { z } from '@studiq/server/lib/zod';
import { parseNotes } from '@studiq/server/services/ai-utils';
import { tool } from 'ai';

const sectionSchema = z.object({
  heading: z.string().describe('Short heading of the section'),
  content: z.string().describe('The body of the section, in short paragraphs or bullet points'),
});

const termSchema = z.object({
  term: z.string(),
  definition: z.string().describe('One sentence'),
});

export const generateNotesTool = tool({
  description:
    'Write structured study notes from the conversation or the given material. The model writes the notes directly in the tool call; this tool validates and returns them. Use it when the user asks for notes, an outline or a study guide, not for flashcards or a plain answer. For long material write the notes in several short sections rather than a few long ones.',
  inputSchema: z.object({
    task: z.string().describe('The user request or the topic the notes are about'),
    title: z.string().describe('Title of the notes'),
    sections: z
      .array(sectionSchema)
      .max(30)
      .describe('The notes in reading order, one idea per section'),
    keyTerms: z
      .array(termSchema)
      .max(50)
      .optional()
      .describe('The terms worth memorising, each with a one-sentence definition'),
    summary: z.string().optional().describe('Two or three sentences that sum the notes up'),
  }),
  execute: ({ task, title, sections, keyTerms, summary }) => {
    try {
      const cid = conversationStorage.getStore()?.conversationId;

      enqueueTrace({
        conversationId: cid,
        agentName: 'general',
        eventType: 'tool_call',
        label: 'generate_notes start',
        data: { task: task.slice(0, 100), inputSections: sections.length },
      });

      const notes = parseNotes({ title, sections, keyTerms, summary });

      if (notes.sections.length === 0 && notes.summary === '') {
        enqueueTrace({
          conversationId: cid,
          agentName: 'general',
          eventType: 'tool_result',
          label: 'generate_notes end',
          data: { sectionCount: 0, keyTermCount: 0, empty: true },
        });
        return {
          type: 'error' as const,
          error: 'The notes have no sections and no summary. Write them again.',
        };
      }

      enqueueTrace({
        conversationId: cid,
        agentName: 'general',
        eventType: 'tool_result',
        label: 'generate_notes end',
        data: { sectionCount: notes.sections.length, keyTermCount: notes.keyTerms.length },
      });

      return { type: 'notes' as const, ...notes };
    } catch (error) {
      return { type: 'error' as const, error: String(error) };
    }
  },
});
