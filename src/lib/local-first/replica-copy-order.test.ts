import { describe, expect, test } from "bun:test";
import { putFirst } from "./replica";

describe("putFirst (the person's current project is copied first)", () => {
  test("moves the chosen project to the front and keeps the rest in the service's order", () => {
    expect(putFirst(["a", "b", "c", "d"], "c")).toEqual(["c", "a", "b", "d"]);
  });
  test("no choice, or a project the person cannot read, leaves the order unchanged", () => {
    expect(putFirst(["a", "b"], null)).toEqual(["a", "b"]);
    expect(putFirst(["a", "b"], undefined)).toEqual(["a", "b"]);
    expect(putFirst(["a", "b"], "zzz")).toEqual(["a", "b"]);
  });
  test("already first stays first, and the input is never mutated", () => {
    const input = ["a", "b"];
    expect(putFirst(input, "a")).toEqual(["a", "b"]);
    putFirst(input, "b");
    expect(input).toEqual(["a", "b"]);
  });
});
