import type { Reporter, FullConfig, Suite, TestCase, TestResult, TestError } from "@playwright/test/reporter";

/**
 * Redacts credential-bearing header VALUES from anything Playwright is
 * about to print to stdout/stderr (and therefore to a CI job log).
 *
 * WHY THIS EXISTS -- do not remove without reading this comment:
 * e2e/*-env1.spec.ts specs run against the real, live, Supabase-authenticated
 * PROJEXA site (https://projexa-ai.com), using storageState cookies from a
 * real login. When an authenticated `page.request.*` call or `page.goto()`
 * times out, Playwright's own error formatting (`formatCallLog` in
 * playwright-core's `client/connection.ts`) appends a verbatim "Call log"
 * block to the thrown error's message/stack -- and that block includes the
 * real outgoing request headers, including `cookie`, which carries a live
 * Supabase GoTrue session (`sb-<project>-auth-token=base64-<JSON with
 * access_token, refresh_token, user email/id>`).
 *
 * Both `compliance-tracker` and `projexa` are PUBLIC GitHub repos, so a
 * GitHub Actions job log containing that text is a world-readable, live,
 * replayable session token -- a real credential leak, not just noisy
 * output.
 *
 * MECHANISM: this reporter is listed FIRST in playwright.config.ts's
 * `reporter:` array. Two independent layers, so neither has to be a
 * perfect model of every place Playwright might print text:
 *
 *  1. Playwright's own `Multiplexer` (node_modules/playwright/lib/runner/
 *     index.js) calls every configured reporter's `onTestEnd`/`onError`
 *     with the SAME `TestResult`/`TestError` object reference, in reporter
 *     array order. Being first means we mutate `result.error`/
 *     `result.errors[]` (message/stack/snippet/value, recursing into
 *     `.cause`) in place before the `list`/`github`/`json` reporters that
 *     run after us ever read them.
 *  2. A `process.stdout`/`process.stderr` `.write` patch, applied once at
 *     module load (before any reporter's onBegin can print a single byte),
 *     redacts any matching text in every chunk written by ANY reporter or
 *     any process this main process forwards output from -- the real
 *     backstop, since it does not depend on the leak arriving through a
 *     `TestError` field we happened to think of.
 *
 * FALSIFIABILITY PROOF: see the PR description for the forced-timeout run
 * (PLAYWRIGHT_BASE_URL pointed at an unreachable port) that confirmed a
 * real Call log gets redacted, then confirmed via `git diff` that the
 * forced-failure change itself was fully reverted.
 */

// Matches a line naming a `cookie`/`authorization`/`set-cookie` header --
// however Playwright/Node happens to prefix it (leading whitespace, a
// "- "/"* "/"=> " call-log bullet, etc.) -- and redacts only the VALUE, so
// it's still visible *that* a credential header was sent, just not what it
// was.
const SENSITIVE_HEADER_LINE = /^([ \t\-*=>]*)(cookie|authorization|set-cookie)([ \t]*:[ \t]*)(.+)$/gim;
const REDACTED = "[REDACTED]";

export function redactSensitiveHeaders(text: string): string {
  return text.replace(SENSITIVE_HEADER_LINE, (_match, prefix: string, name: string, sep: string) => `${prefix}${name}${sep}${REDACTED}`);
}

function redactMaybe(text: string | undefined): string | undefined {
  return text === undefined ? text : redactSensitiveHeaders(text);
}

function redactError(error: TestError | null | undefined, seen: Set<TestError> = new Set()): void {
  if (!error || seen.has(error)) return;
  seen.add(error);
  error.message = redactMaybe(error.message);
  error.stack = redactMaybe(error.stack);
  error.snippet = redactMaybe(error.snippet);
  error.value = redactMaybe(error.value);
  if (error.cause) redactError(error.cause, seen);
}

function redactChunk<T extends string | Buffer>(chunk: T): T {
  if (Buffer.isBuffer(chunk)) return Buffer.from(redactSensitiveHeaders(chunk.toString("utf8")), "utf8") as T;
  return redactSensitiveHeaders(chunk as string) as T;
}

let stdioPatched = false;
function patchStdioOnce(): void {
  if (stdioPatched) return;
  stdioPatched = true;
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === "string" || Buffer.isBuffer(chunk)) chunk = redactChunk(chunk as string | Buffer);
      // @ts-expect-error -- forwarding whatever encoding/callback args were passed through unchanged
      return original(chunk, ...rest);
    }) as typeof stream.write;
  }
}

// Applied at module load, before this or any other configured reporter's
// onBegin can run -- see MECHANISM layer 2 above.
patchStdioOnce();

export default class RedactCredentialHeadersReporter implements Reporter {
  onBegin(_config: FullConfig, _suite: Suite): void {
    patchStdioOnce();
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    redactError(result.error);
    for (const error of result.errors ?? []) redactError(error);
  }

  onError(error: TestError): void {
    redactError(error);
  }
}
