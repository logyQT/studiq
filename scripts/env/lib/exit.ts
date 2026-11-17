/**
 * Lifecycle exit codes (spec §2.1).
 *
 * `2` covers bad usage (including impossible atom combinations), `3` a missing
 * native runtime, `4` a failed start/build, `5` a timeout, `6` a conflict
 * (another checkout owns the stack, shared-mode refusal, missing capability) and
 * `7` a build that waited out its slot budget without being admitted.
 */
/** @public Exercised by the unit tests, which load this module by computed URL. */
export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_NATIVE_UNAVAILABLE = 3;
export const EXIT_START_FAILED = 4;
export const EXIT_TIMEOUT = 5;
export const EXIT_CONFLICT = 6;
/** Waited the full slot budget without being admitted (ADR-0014, decision 5). */
export const EXIT_QUEUED = 7;

/** A failure with an explicit exit code and a message safe to print. */
export class EnvFailure extends Error {
  constructor(
    readonly exitCode: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EnvFailure';
  }
}
