/// <reference types="bun-types" />
// R67 F-30. A profiler that changes what it profiles is worse than none, so
// the first two things asserted here are that it is invisible when off and
// transparent when on.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latencyDebugEnabled, timeUpstream } from "./debug-latency";

const original = { flag: process.env.DEBUG_LATENCY, file: process.env.DEBUG_LATENCY_FILE };
const created: string[] = [];

afterEach(() => {
  if (original.flag === undefined) delete process.env.DEBUG_LATENCY;
  else process.env.DEBUG_LATENCY = original.flag;
  if (original.file === undefined) delete process.env.DEBUG_LATENCY_FILE;
  else process.env.DEBUG_LATENCY_FILE = original.file;
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "r67-latency-"));
  created.push(dir);
  return join(dir, "labour.jsonl");
}

describe("timeUpstream", () => {
  test("is a plain pass-through when DEBUG_LATENCY is not set", async () => {
    delete process.env.DEBUG_LATENCY;
    delete process.env.DEBUG_LATENCY_FILE;
    expect(latencyDebugEnabled()).toBe(false);
    expect(await timeUpstream("labour:roster", async () => ({ roster: [1, 2] }))).toEqual({ roster: [1, 2] });
  });

  test("returns the call's own value unchanged when enabled", async () => {
    process.env.DEBUG_LATENCY = "1";
    delete process.env.DEBUG_LATENCY_FILE;
    expect(await timeUpstream("labour:roster", async () => "rows")).toBe("rows");
  });

  test("writes one JSON line per call, with the label and a real duration", async () => {
    const file = tempFile();
    process.env.DEBUG_LATENCY = "1";
    process.env.DEBUG_LATENCY_FILE = file;

    await timeUpstream("labour:roster+attendance-summary", async () => {
      await new Promise((r) => setTimeout(r, 25));
      return null;
    });
    await timeUpstream("labour:screen-definitions", async () => null);

    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].label).toBe("labour:roster+attendance-summary");
    // A real measurement of a real 25 ms sleep, not a recorded constant.
    expect(lines[0].ms).toBeGreaterThanOrEqual(20);
    expect(lines[0].outcome).toBe("ok");
    expect(lines[1].label).toBe("labour:screen-definitions");
    expect(typeof lines[0].at).toBe("string");
  });

  test("a FAILED call is timed and recorded, then re-thrown -- it is the most interesting line in the log", async () => {
    const file = tempFile();
    process.env.DEBUG_LATENCY = "1";
    process.env.DEBUG_LATENCY_FILE = file;

    await expect(
      timeUpstream("labour:roster", async () => {
        throw new Error("upstream timed out");
      })
    ).rejects.toThrow("upstream timed out");

    const line = JSON.parse(readFileSync(file, "utf8").trim());
    expect(line.outcome).toBe("error");
    expect(line.label).toBe("labour:roster");
  });

  test("an unwritable log path never breaks the page being profiled", async () => {
    process.env.DEBUG_LATENCY = "1";
    process.env.DEBUG_LATENCY_FILE = join(tmpdir(), "r67-does-not-exist", "nested", "nope.jsonl");
    expect(await timeUpstream("labour:roster", async () => "still fine")).toBe("still fine");
  });
});
