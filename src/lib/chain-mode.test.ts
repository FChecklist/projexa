/// <reference types="bun-types" />
// R67 WS-A (A-05). The whole point of deriving the mode is that the POST body
// is unchanged, so the test that matters is the one that pins the mapping.
import { describe, test, expect } from "bun:test";
import { deriveMode } from "./chain-mode";

describe("deriveMode", () => {
  test("an empty chain is a project chain -- the old DEFAULT_CHAIN_MODE", () => {
    expect(deriveMode([])).toBe("projects");
  });

  test("a customers chain is derived from its own first step", () => {
    expect(deriveMode([{ id: "customers" }])).toBe("customers");
  });

  test("a vendors chain likewise", () => {
    expect(deriveMode([{ id: "vendors" }])).toBe("vendors");
  });

  test("the project root is not a choice and never decides the mode", () => {
    expect(deriveMode([{ id: "proj-1", kind: "root" }, { id: "customers", kind: "action" }])).toBe("customers");
  });

  test("only the FIRST chosen step decides it", () => {
    expect(deriveMode([{ id: "permits", kind: "action" }, { id: "customers", kind: "step" }])).toBe("projects");
  });

  test("any other module is a project chain", () => {
    expect(deriveMode([{ id: "permits", kind: "action" }])).toBe("projects");
    expect(deriveMode([{ id: "work-progress", kind: "action" }])).toBe("projects");
  });

  test("case and singular spelling do not change the answer", () => {
    expect(deriveMode([{ id: "Customers" }])).toBe("customers");
    expect(deriveMode([{ id: "vendor" }])).toBe("vendors");
  });
});
