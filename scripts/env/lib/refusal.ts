import type { ParsedCommand } from '../atoms';
import type { Contract } from './contract';
import { EXIT_CONFLICT, EnvFailure } from './exit';
import { printJson } from './output';
import { collectSnapshot } from './snapshot';

/**
 * Refuse a second environment without touching the live server or `.next`.
 * `--json` still gets one valid contract object on stdout (with the refusal in
 * `warnings`); human output is the single error line on stderr.
 */
export async function refuseSecondServer(
  parsed: ParsedCommand,
  contract: Contract,
  message: string,
): Promise<never> {
  if (parsed.json) {
    printJson(await collectSnapshot({ contract, ready: false, warnings: [message] }));
  }
  throw new EnvFailure(EXIT_CONFLICT, message);
}
