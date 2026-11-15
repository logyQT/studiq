import { describe, expect, it } from 'vitest';
import {
  commandInstruction,
  commandOfLastMessage,
  matchSlashCommands,
  parseSlashCommand,
  SLASH_COMMANDS,
} from '@studiq/server/lib/ai/commands';

const explain = SLASH_COMMANDS.find((command) => command.name === 'explain');

const message = (role: string, text: string) => ({ role, parts: [{ type: 'text', text }] });

describe('SLASH_COMMANDS', () => {
  it('has unique lower-case English names and a description and hint key for each', () => {
    const names = SLASH_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const command of SLASH_COMMANDS) {
      expect(command.name).toMatch(/^[a-z]+$/);
      expect(command.descriptionKey).toMatch(/^command_[a-z_]+$/);
      expect(command.argumentHintKey).toMatch(/^command_[a-z_]+$/);
    }
  });

  it('keeps the registry data-only: no imports, so the client bundle stays free of server code', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../../packages/server/src/lib/ai/commands.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  it('names /explain', () => {
    expect(explain).toBeDefined();
  });
});

describe('parseSlashCommand', () => {
  it('reads the command and its arguments', () => {
    expect(parseSlashCommand('/explain photosynthesis')).toEqual({
      command: explain,
      args: 'photosynthesis',
    });
  });

  it('allows leading whitespace and keeps the rest of the line, trimmed', () => {
    expect(parseSlashCommand('   \n /explain   the Krebs cycle  ')?.args).toBe('the Krebs cycle');
  });

  it('answers with empty arguments when there are none', () => {
    expect(parseSlashCommand('/explain')?.args).toBe('');
    expect(parseSlashCommand('/explain   ')?.args).toBe('');
  });

  it('keeps a multi-line argument whole', () => {
    expect(parseSlashCommand('/explain osmosis\nand diffusion')?.args).toBe(
      'osmosis\nand diffusion',
    );
  });

  it('is case-insensitive about the command name only', () => {
    expect(parseSlashCommand('/EXPLAIN Osmosis')).toEqual({ command: explain, args: 'Osmosis' });
  });

  it.each([
    ['a bare slash', '/'],
    ['a slash and spaces', '/   '],
    ['an unknown command', '/nope something'],
    ['a longer word that begins with a command', '/explaining photosynthesis'],
    ['a slash in the middle of the text', 'please /explain photosynthesis'],
    ['a path-like text', 'http://example.com/explain'],
    ['no slash at all', 'explain photosynthesis'],
    ['an empty message', ''],
  ])('is not a command: %s', (_label, text) => {
    expect(parseSlashCommand(text)).toBeNull();
  });
});

describe('matchSlashCommands', () => {
  it('offers every command for a bare slash', () => {
    expect(matchSlashCommands('/')).toEqual(SLASH_COMMANDS);
  });

  it('filters by the prefix typed so far, ignoring case and leading whitespace', () => {
    expect(matchSlashCommands('/ex')).toEqual([explain]);
    expect(matchSlashCommands('  /EXPL')).toEqual([explain]);
    expect(matchSlashCommands('/zzz')).toEqual([]);
  });

  it('closes once a space follows the name, or when the text is not a command start', () => {
    expect(matchSlashCommands('/explain ')).toEqual([]);
    expect(matchSlashCommands('/explain photosynthesis')).toEqual([]);
    expect(matchSlashCommands('hello /ex')).toEqual([]);
    expect(matchSlashCommands('')).toEqual([]);
  });
});

describe('commandInstruction', () => {
  it('puts the concept into the instruction', () => {
    const parsed = parseSlashCommand('/explain photosynthesis');
    const instruction = parsed ? commandInstruction(parsed) : '';
    expect(instruction).toContain('/explain');
    expect(instruction).toContain('photosynthesis');
    expect(instruction).not.toContain('{args}');
  });

  it('asks which concept when there is none, without calling a tool', () => {
    const parsed = parseSlashCommand('/explain');
    const instruction = parsed ? commandInstruction(parsed) : '';
    expect(instruction).toMatch(/which concept/);
    expect(instruction).toMatch(/do not call any tool/);
  });

  it('inserts the arguments literally, whatever characters they hold', () => {
    const parsed = parseSlashCommand("/explain $& $' `x` {args}");
    expect(parsed && commandInstruction(parsed)).toContain("$& $' `x` {args}");
  });
});

describe('commandOfLastMessage', () => {
  it('finds the command of the user message being answered', () => {
    const parsed = commandOfLastMessage([message('user', '/explain osmosis')]);
    expect(parsed?.args).toBe('osmosis');
  });

  it('survives a retry: the stored transcript carries the command message last', () => {
    const transcript = [
      message('user', 'hi'),
      message('assistant', 'hello'),
      message('user', '/explain osmosis'),
    ];
    expect(commandOfLastMessage(transcript)?.command.name).toBe('explain');
  });

  it('applies to its own turn only', () => {
    const transcript = [
      message('user', '/explain osmosis'),
      message('assistant', 'Osmosis is ...'),
      message('user', 'thanks, and diffusion?'),
    ];
    expect(commandOfLastMessage(transcript)).toBeNull();
  });

  it('ignores a command in an assistant message and an empty transcript', () => {
    expect(commandOfLastMessage([message('assistant', '/explain osmosis')])).toBeNull();
    expect(commandOfLastMessage([])).toBeNull();
  });

  it('joins the text parts and skips the rest', () => {
    const parsed = commandOfLastMessage([
      {
        role: 'user',
        parts: [
          { type: 'step-start' },
          { type: 'text', text: '/explain ' },
          { type: 'text', text: 'osmosis' },
        ],
      },
    ]);
    expect(parsed?.args).toBe('osmosis');
  });
});
