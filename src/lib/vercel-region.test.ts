/// <reference types="bun-types" />
// R67 F-32 (audit recommendation R-276) -- the functions must run beside the
// database, and must keep doing so.
//
// WHY THIS IS A TEST AND NOT A NOTE. Every PROJEXA request is a serverless
// function talking to a Postgres pooler in ap-south-1 (Mumbai). A function
// scheduled in Washington adds a round trip of ~200 ms to EVERY query it
// makes, which on a screen making several is most of a second of pure
// geography -- and the whole F2 lane's budget is 400 ms TTFB. `regions:
// ["bom1"]` puts the function next to the pooler.
//
// It is one line in a config file that nothing else reads, which is exactly
// the kind of setting that gets dropped in a merge and is never noticed again,
// because the symptom is "the app feels a bit slow" rather than an error. So
// it is asserted, in the same suite CI already runs.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const vercelConfig = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "vercel.json"), "utf8")) as {
  regions?: string[];
};

describe("vercel.json", () => {
  test("pins serverless functions to bom1, beside the ap-south-1 pooler", () => {
    expect(vercelConfig.regions).toEqual(["bom1"]);
  });
});
