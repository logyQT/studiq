import type { ParsedCommand } from '../atoms';
import type { Contract } from './contract';
import { EXIT_CONFLICT, EnvFailure } from './exit';
import { printJson } from './output';
import { collectSnapshot } from './snapshot';

/** Refuse without touching the server/.next; `--json` still gets one object. */
export async function refuseConflict(
  parsed: ParsedCommand,
  contract: Contract,
  message: string,
): Promise<never> {
  if (parsed.json) {
    printJson(await collectSnapshot({ contract, ready: false, warnings: [message] }));
  }
  throw new EnvFailure(EXIT_CONFLICT, message);
}
