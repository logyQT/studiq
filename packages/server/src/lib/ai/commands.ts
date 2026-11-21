/**
 * Slash commands of the AI chat: `/explain [concept]`, and whatever follows.
 *
 * One registry, read on both sides. The composer uses it for the command menu; the chat route uses
 * it to turn a message that starts with a command into the instruction the model gets. The
 * transcript is never rewritten: the user sees the `/explain …` they typed, and the server derives
 * the instruction from the stored messages on every request, so a retry (`regenerate()`, which
 * re-sends the transcript with no options) behaves like the first send.
 *
 * Data and pure functions only, and no imports: the client bundles this module, and importing a
 * tool object from here would pull `node:async_hooks` into it. A command that needs a tool names
 * it as a string.
 */

/**
 * What the model is told when the command is used. `{args}` stands for the text after the command;
 * `emptyTemplate` is used when there is none. Both are instructions to the model, not user copy.
 */
export interface PromptPolicy {
  kind: 'prompt';
  template: string;
  emptyTemplate: string;
}

export interface SlashCommand {
  /** The token after the slash. Stays English in every locale. */
  name: string;
  /** Keys under `AiChatPage` in the message catalogs. */
  descriptionKey: string;
  argumentHintKey: string;
  policy: PromptPolicy;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: 'explain',
    descriptionKey: 'command_explain_description',
    argumentHintKey: 'command_explain_hint',
    policy: {
      kind: 'prompt',
      template:
        'The user invoked the /explain command for this concept: {args}\n' +
        'Explain it for a learner. Start with a one-sentence definition, then the key idea in plain ' +
        'language, then one concrete example, and end with one short question that checks ' +
        'understanding. Answer in text; do not call any tool.',
      emptyTemplate:
        'The user invoked the /explain command without naming a concept. Ask in one short sentence ' +
        'which concept they want explained. Answer in text; do not call any tool.',
    },
  },
];

export interface ParsedSlashCommand {
  command: SlashCommand;
  /** The text after the command, trimmed. Empty when there is none. */
  args: string;
}

/**
 * The command a message starts with, or `null`. Leading whitespace is ignored; a slash anywhere
 * else, a bare `/`, an unknown token and a longer word that merely begins with a command name
 * (`/explaining`) are not commands.
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) return null;

  const token = /^\/(\S+)/.exec(trimmed)?.[1]?.toLowerCase();
  if (!token) return null;

  const command = SLASH_COMMANDS.find((candidate) => candidate.name === token);
  if (!command) return null;

  return { command, args: trimmed.slice(1 + token.length).trim() };
}

/**
 * The commands the menu offers for what is typed so far: the text is only a command name, with
 * nothing after it yet. Once a space follows the name, the menu has done its job and closes.
 */
export function matchSlashCommands(text: string): readonly SlashCommand[] {
  const typed = /^\s*\/(\S*)$/.exec(text)?.[1];
  if (typed === undefined) return [];
  const prefix = typed.toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(prefix));
}

/** The instruction for the model that a parsed command stands for. */
export function commandInstruction({ command, args }: ParsedSlashCommand): string {
  const { template, emptyTemplate } = command.policy;
  return args ? template.replace('{args}', () => args) : emptyTemplate;
}

/** The part of a UI message the commands care about. */
export interface ChatMessageLike {
  role: string;
  parts: readonly { type: string; text?: string }[];
}

/**
 * The command of the turn being answered: the one the last message starts with, if that message
 * is the user's. A command applies to its own turn only; the next ordinary message starts a turn
 * with no command.
 */
export function commandOfLastMessage(
  messages: readonly ChatMessageLike[],
): ParsedSlashCommand | null {
  const last = messages.at(-1);
  if (last?.role !== 'user') return null;
  const text = last.parts.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('');
  return parseSlashCommand(text);
}
