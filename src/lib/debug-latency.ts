// R67 F-30 (audit recommendation R-274) -- SERVER-SIDE TIMING FOR ONE LOAD.
//
// R-274's first instruction is to stop guessing: profile the server render of
// /labour before restructuring it, and record what each upstream call actually
// costs. Nothing in this repo measured a SERVER component's calls -- F-28's
// withTiming() covers /api/* route handlers, which a server component does not
// go through. This closes that gap for the pages that ask for it.
//
// OFF BY DEFAULT AND OFF IN PRODUCTION. Every call is a plain pass-through
// unless DEBUG_LATENCY=1 is set, so the instrumented pages carry no cost, no
// log noise and no file handle in normal operation. That is deliberate: a
// profiler you have to remember to remove is one that eventually ships.
//
//   DEBUG_LATENCY=1                     -> console.time / console.timeEnd per call
//   DEBUG_LATENCY_FILE=<path>           -> also appends one JSON line per call
//
// The file is the artefact R-274 asks to be kept beside the audit: one line
// per upstream call, with its label and its real duration, so "the shell's
// calls plus roster and attendance" for a single load is a readable record
// rather than a screenshot of a terminal.

import { appendFile } from "node:fs/promises";

export function latencyDebugEnabled(): boolean {
  return process.env.DEBUG_LATENCY === "1";
}

/**
 * Times one upstream call.
 *
 * `label` should name the CALL, not the page -- "labour:roster+summary",
 * "labour:screen-definitions" -- because the point of the record is to see
 * which of a page's calls is expensive, not that the page is.
 *
 * The timing never changes what the call returns, and a failure is timed and
 * re-thrown rather than swallowed: a call that took four seconds and then
 * failed is the single most interesting line in any such log.
 */
export async function timeUpstream<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!latencyDebugEnabled()) return fn();

  // console.time is what R-274 names, and it is what shows up in the dev
  // server's own output beside the request line.
  const timerLabel = `[latency] ${label}`;
  console.time(timerLabel);
  const startedAt = Date.now();
  let outcome: "ok" | "error" = "ok";
  try {
    return await fn();
  } catch (err) {
    outcome = "error";
    throw err;
  } finally {
    console.timeEnd(timerLabel);
    await writeLatencyLine({ label, ms: Date.now() - startedAt, outcome });
  }
}

async function writeLatencyLine(entry: { label: string; ms: number; outcome: "ok" | "error" }): Promise<void> {
  const file = process.env.DEBUG_LATENCY_FILE;
  if (!file) return;
  try {
    await appendFile(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch (err) {
    // A profiler must never be able to break the page it is profiling.
    console.error("[latency] could not append to DEBUG_LATENCY_FILE:", err instanceof Error ? err.message : err);
  }
}
