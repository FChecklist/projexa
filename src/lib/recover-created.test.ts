// Sumeet audit 2026-10-20 (defect 1): after a save timed out, the screen re-reads its list for the record it was making.
import { describe, expect, test } from "bun:test";
import { findRecentBoq, findRecentSiteInstruction, lookForCreated } from "./recover-created";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const sent = { issueDate: "2026-10-20", toContractor: "Apex MEP", description: "Move the wall" };
const row = (over: Record<string, unknown> = {}) => ({ id: "si-1", siNumber: 3, issueDate: "2026-10-20", toContractor: "Apex MEP", description: "Move the wall", createdAt: "2026-10-20T09:59:30Z", ...over });

describe("findRecentSiteInstruction", () => {
  test("finds the same date, contractor and text created in the last minute", () => {
    expect(findRecentSiteInstruction([row()], sent, NOW)?.id).toBe("si-1");
  });
  test("text is compared trimmed and case-insensitively", () => {
    expect(findRecentSiteInstruction([row({ toContractor: " apex mep ", description: "MOVE THE WALL " })], sent, NOW)?.id).toBe("si-1");
  });
  test("an identical record from before the last minute is not the one just made", () => {
    expect(findRecentSiteInstruction([row({ createdAt: "2026-10-20T09:50:00Z" })], sent, NOW)).toBeNull();
  });
  test("a different date, contractor or text does not match", () => {
    for (const over of [{ issueDate: "2026-10-19" }, { toContractor: "Other" }, { description: "Other" }]) {
      expect(findRecentSiteInstruction([row(over)], sent, NOW)).toBeNull();
    }
  });
  test("the newest of several matches wins; nothing at all is null", () => {
    expect(findRecentSiteInstruction([row({ id: "a", createdAt: "2026-10-20T09:59:10Z" }), row({ id: "b", createdAt: "2026-10-20T09:59:50Z" })], sent, NOW)?.id).toBe("b");
    expect(findRecentSiteInstruction([], sent, NOW)).toBeNull();
    expect(findRecentSiteInstruction(undefined, sent, NOW)).toBeNull();
  });
});

describe("findRecentBoq", () => {
  const boq = { id: "b1", title: "Villa BOQ", status: "draft", createdAt: "2026-10-20T09:59:00Z" };
  test("same title, draft, recent", () => expect(findRecentBoq([boq], { title: " villa boq " }, NOW)?.id).toBe("b1"));
  test("another title, an approved BOQ, or an old one does not match", () => {
    expect(findRecentBoq([boq], { title: "Other" }, NOW)).toBeNull();
    expect(findRecentBoq([{ ...boq, status: "approved" }], { title: "Villa BOQ" }, NOW)).toBeNull();
    expect(findRecentBoq([{ ...boq, createdAt: "2026-10-20T09:00:00Z" }], { title: "Villa BOQ" }, NOW)).toBeNull();
  });
});

describe("lookForCreated", () => {
  const noWait = async () => {};
  test("returns the first hit and stops looking", async () => {
    let calls = 0;
    const hit = await lookForCreated(async () => (++calls === 2 ? "found" : null), { sleep: noWait });
    expect(hit).toBe("found");
    expect(calls).toBe(2);
  });
  test("a throwing read is a miss, and three misses give null", async () => {
    let calls = 0;
    const hit = await lookForCreated(async () => { calls++; throw new Error("503"); }, { sleep: noWait });
    expect(hit).toBeNull();
    expect(calls).toBe(3);
  });
});
