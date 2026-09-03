import { describe, expect, test } from "bun:test";
import {
  TIMING_ELAPSED_MS,
  answerRowsFrom,
  TIMING_QUIET_MS,
  TIMING_STALLED_MS,
  previewSteps,
  progressReceiptLine,
  readPreviewSegments,
  shortDate,
  timingState,
  understoodLine,
} from "./composer-turns";

describe("the Understood line", () => {
  test("C-05's own example, in the strip's grammar", () => {
    expect(understoodLine(["Cedar Heights", "Work Progress", "Record progress", "Excavation"])).toBe(
      "Understood: Cedar Heights > Work Progress > Record progress > Excavation"
    );
  });

  test("blank steps are dropped rather than rendered as empty links in the sentence", () => {
    expect(understoodLine(["Cedar Heights", "  ", "Work Progress"])).toBe(
      "Understood: Cedar Heights > Work Progress"
    );
  });

  test("an empty chain says so rather than trailing off after the colon", () => {
    expect(understoodLine([])).toBe("Understood, but I could not place it on a screen yet");
    expect(understoodLine(["  "])).not.toBe("Understood: ");
  });
});

describe("the receipt", () => {
  test("C-05's sentence, verbatim, when every fact exists", () => {
    expect(
      progressReceiptLine({
        lineLabel: "Excavation",
        itemCode: "R60SK-A",
        percent: 50,
        date: "2026-09-02",
        recordId: "WP-0412",
      })
    ).toBe("✓ Progress saved: Excavation (R60SK-A) 50% on 02-09-2026 — WP-0412");
  });

  test("*** A FACT THAT DOES NOT EXIST IS DROPPED, NEVER INVENTED ***", () => {
    const line = progressReceiptLine({ lineLabel: "Excavation", percent: 50, date: "2026-09-02" });
    expect(line).toBe("✓ Progress saved: Excavation 50% on 02-09-2026");
    expect(line).not.toContain("()");
    expect(line).not.toContain("—");
    // A blank code or id is the same as no code or id.
    expect(progressReceiptLine({ lineLabel: "X", itemCode: "  ", recordId: " ", percent: 1, date: "2026-01-02" })).toBe(
      "✓ Progress saved: X 1% on 02-01-2026"
    );
  });

  test("the date reads the way Sumeet's own screens read it", () => {
    expect(shortDate("2026-09-02")).toBe("02-09-2026");
    // Anything that is not an ISO date is passed through, never mangled.
    expect(shortDate("today")).toBe("today");
  });
});

describe("the timing states are mandatory and in this order", () => {
  test("nothing at all for the first 300 ms", () => {
    expect(timingState(0)).toEqual({ phase: "idle", text: null, actions: [] });
    expect(timingState(TIMING_QUIET_MS - 1).phase).toBe("idle");
  });

  test("from 300 ms: the promise, with a Stop word-button", () => {
    const s = timingState(TIMING_QUIET_MS);
    expect(s.phase).toBe("working");
    expect(s.text).toBe("Working… (usually 3 s)");
    expect(s.actions).toEqual(["stop"]);
  });

  test("after 5 s: the elapsed seconds, because a promise has stopped being true", () => {
    expect(timingState(TIMING_ELAPSED_MS).text).toBe("Working… 5 s");
    expect(timingState(7_400).text).toBe("Working… 7 s");
    expect(timingState(7_400).actions).toEqual(["stop"]);
  });

  test("at 20 s: name the service, and offer the choice rather than deciding", () => {
    const s = timingState(TIMING_STALLED_MS);
    expect(s.phase).toBe("stalled");
    expect(s.text).toBe("Still waiting on the construction data service");
    expect(s.actions).toEqual(["keep", "cancel"]);
  });

  test("every non-idle state offers a way out", () => {
    for (const ms of [400, 6_000, 30_000]) expect(timingState(ms).actions.length).toBeGreaterThan(0);
  });
});

describe("reading the preview response", () => {
  const RESPONSE = {
    executed: false,
    segments: [
      {
        index: 0,
        verdict: "task",
        functionId: "record_work_progress",
        params: { itemCode: "R60SK-A", percent: 50 },
        missingParams: [],
        derivedChain: { root: "Cedar Heights", steps: ["Work Progress", "New entry"], full: "x" },
        message: null,
      },
    ],
  };

  test("a real response yields the segment band 2 renders", () => {
    const segs = readPreviewSegments(RESPONSE);
    expect(segs).toHaveLength(1);
    expect(segs[0].functionId).toBe("record_work_progress");
    expect(segs[0].params.percent).toBe(50);
    expect(previewSteps(segs[0])).toEqual(["Cedar Heights", "Work Progress", "New entry"]);
  });

  test("a partial resolution carries its missing slots, so band 2 can ask", () => {
    const segs = readPreviewSegments({
      segments: [
        { verdict: "task", functionId: "record_work_progress", params: {}, missingParams: ["itemCode"], derivedChain: null },
      ],
    });
    expect(segs[0].missingParams).toEqual(["itemCode"]);
    expect(previewSteps(segs[0])).toEqual([]);
  });

  test("a malformed segment is dropped, never rendered as a turn with blank facts", () => {
    const segs = readPreviewSegments({
      segments: [null, "nope", { verdict: "banana" }, { verdict: "chat", functionId: null }],
    });
    expect(segs).toHaveLength(1);
    expect(segs[0].verdict).toBe("chat");
  });

  test("a response that is not a preview at all yields nothing, not a fabricated turn", () => {
    expect(readPreviewSegments(null)).toEqual([]);
    expect(readPreviewSegments({ error: "boom" })).toEqual([]);
    expect(readPreviewSegments({ segments: "no" })).toEqual([]);
  });
});

describe("answerRowsFrom -- rows first, but only when the rows are real", () => {
  test("an array of real rows becomes rows", () => {
    const rows = answerRowsFrom([
      { id: "a", itemCode: "EX-01", description: "Excavation", percentComplete: 50 },
      { id: "b", itemCode: "EX-02", description: "Backfill" },
    ]);
    expect(rows).toEqual([
      { id: "a", label: "Excavation", value: "50" },
      { id: "b", label: "Backfill", value: undefined },
    ]);
  });

  test("an object with exactly one array property is unwrapped", () => {
    expect(answerRowsFrom({ count: 2, activities: [{ id: "x", name: "Excavation" }] })).toEqual([
      { id: "x", label: "Excavation", value: undefined },
    ]);
  });

  test("*** A SHAPE NOBODY CHECKED PRODUCES NO ROWS, NOT AN INVENTED TABLE ***", () => {
    expect(answerRowsFrom({ budget: 1000, revenue: 2000 })).toEqual([]);
    expect(answerRowsFrom({ a: [1], b: [2] })).toEqual([]);
    expect(answerRowsFrom("nope")).toEqual([]);
    expect(answerRowsFrom(null)).toEqual([]);
    // Objects with no recognisable words are dropped rather than rendered blank.
    expect(answerRowsFrom([{ id: "a", foo: 1 }])).toEqual([]);
  });

  test("the list is capped, so one answer cannot fill the whole band", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
    expect(answerRowsFrom(many)).toHaveLength(8);
    expect(answerRowsFrom(many, 3)).toHaveLength(3);
  });
});
