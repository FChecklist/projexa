/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { project360ToCsv } from "./project-360-export";

describe("project360ToCsv (Sumeet R-99 / R-100 download)", () => {
  const csv = project360ToCsv("UAT Villa", "13-10-2026", {
    profit: [["Expected profit", "AED 1,000"], ["Actual profit (gross)", "Not yet baselined"]],
    boq: [["Contract now", "AED 5,000"]],
    counts: [["Scope changes", "2"], ["=cmd", "x"]],
  });
  test("carries the title, each block heading and every measure with the value the screen shows", () => {
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Project 360 analysis - UAT Villa - 13-10-2026");
    expect(lines).toContain("Profit and loss");
    expect(lines).toContain("Expected profit,\"AED 1,000\"");
    expect(lines).toContain("Actual profit (gross),Not yet baselined");
    expect(lines).toContain("Contract now,\"AED 5,000\"");
  });
  test("text starting with = is stored as text, not a formula", () => {
    expect(csv.split("\n")).toContain("'=cmd,x");
  });
});
