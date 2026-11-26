import { qaAppUrl } from '#test/helpers/qa-pointer';

/**
 * Playwright `globalSetup` of the QA suite (#1286): stops a run that was not told which app to hit
 * before its first test, with the message that says how to tell it. The config itself only
 * resolves the URL (it is loaded by listing and by tooling that must not throw); the refusal
 * belongs to the moment tests would actually run.
 */
export default function requireAppUrl(): void {
  qaAppUrl();
}
