/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { logOutboxEvent } from "./outbox-actions";

const ev = (type: string) => ({ type, opId: "o", functionId: "update_line_item_budget", projectId: "p", kind: null, recordId: null, message: "m" }) as never;
function run(type: string, label: string | null = "Set a line budget") {
  const seen: [string, string][] = [];
  logOutboxEvent(ev(type), { labelOf: () => label, log: (n, o) => void seen.push([n, o]) });
  return seen;
}

describe("saves made on the laptop reach the project timeline", () => {
  test("applied is worked, rejected is failed, named by the function's plain label", () => {
    expect(run("applied")).toEqual([["Set a line budget", "ok"]]);
    expect(run("rejected")).toEqual([["Set a line budget", "failed"]]);
  });
  test("other events, and a function with no label, log nothing; a throwing logger is swallowed", () => {
    expect(run("changed")).toEqual([]);
    expect(run("conflict")).toEqual([]);
    expect(run("applied", null)).toEqual([]);
    expect(() => logOutboxEvent(ev("applied"), { labelOf: () => "x", log: () => { throw new Error("boom"); } })).not.toThrow();
  });
});
