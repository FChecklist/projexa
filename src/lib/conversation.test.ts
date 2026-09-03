import { describe, expect, test } from "bun:test";
import {
  MAX_TURNS,
  appendTurn,
  conversationKey,
  isStale,
  editInFormRoute,
  missingFieldLabel,
  paramLabel,
  parseTurns,
  readAsLine,
  readableDate,
  recordLabel,
  recordedReceiptLine,
  serialiseTurns,
  staleNote,
  type ConversationTurn,
} from "./conversation";

describe("readAsLine", () => {
  test("C-09's understood line, verbatim", () => {
    expect(
      readAsLine(["Record Work Progress > New entry", "Cedar Heights Villa - Phase 1", "today", "50%", "Excavation"])
    ).toBe(
      "I read this as: Record Work Progress > New entry > Cedar Heights Villa - Phase 1 > today > 50% > Excavation"
    );
  });

  test("with nothing resolved it says so rather than printing a bare prefix", () => {
    expect(readAsLine([])).toBe("I read this as: nothing I can act on yet");
    expect(readAsLine(["", "  "])).toBe("I read this as: nothing I can act on yet");
  });
});

describe("recordLabel", () => {
  test("is 'Record' when nothing is missing, and carries the count when something is", () => {
    expect(recordLabel(0)).toBe("Record");
    expect(recordLabel(-1)).toBe("Record");
    expect(recordLabel(1)).toBe("Record (1 missing)");
    expect(recordLabel(3)).toBe("Record (3 missing)");
  });
});

describe("recordedReceiptLine", () => {
  test("C-09's receipt, with a short human id", () => {
    expect(
      recordedReceiptLine({ recordId: "WP-000123", percent: 50, lineCode: "R60SK-A", date: "2026-09-02" })
    ).toBe("Recorded. WP-000123 - 50% on R60SK-A, 02 Sep 2026.");
  });

  test("a cuid is NOT printed -- the line names the work instead of an opaque key", () => {
    expect(
      recordedReceiptLine({
        recordId: "clx8n2k4b0000abcd1234wxyz",
        percent: 50,
        lineCode: "R60SK-A",
        date: "2026-09-02",
      })
    ).toBe("Recorded. 50% on R60SK-A, 02 Sep 2026.");
  });

  test("a write with no percent and no line still reads as a sentence", () => {
    expect(recordedReceiptLine({ date: "2026-09-02" })).toBe("Recorded. 02 Sep 2026.");
  });

  test("an ISO timestamp is accepted, not only a bare date", () => {
    expect(recordedReceiptLine({ percent: 100, date: "2026-09-02T11:04:00.000Z" })).toBe(
      "Recorded. 100%, 02 Sep 2026."
    );
  });
});

describe("readableDate", () => {
  test("is the fixed table, and leaves a non-date alone", () => {
    expect(readableDate("2026-09-02")).toBe("02 Sep 2026");
    expect(readableDate("soon")).toBe("soon");
  });
});

describe("staleNote", () => {
  test("names the project the card was for", () => {
    expect(staleNote("Cedar Heights Villa - Phase 1")).toBe("was for Cedar Heights Villa - Phase 1");
    expect(staleNote(null)).toBe("was for another project");
  });
});

describe("missingFieldLabel", () => {
  test("is D-03's sentence, never the camelCase parameter", () => {
    expect(missingFieldLabel("itemCode")).toBe("Pick a BOQ line");
    expect(missingFieldLabel("boq_line_item_id")).toBe("Pick a BOQ line");
    expect(missingFieldLabel("percent")).toBe("Type quantity or %");
    expect(missingFieldLabel("projectId")).toBe("Pick a project");
  });

  test("an unmapped slot still gets a sentence a person can act on", () => {
    expect(missingFieldLabel("someNewSlot")).toBe("Answer the question above");
  });
});

describe("the turn log", () => {
  const turn = (id: string, projectId: string | null = "p1"): ConversationTurn => ({
    kind: "said",
    id,
    at: 1,
    projectId,
    text: `t${id}`,
  });

  test("keeps a conversation, but band 2 stays a band", () => {
    let turns: ConversationTurn[] = [];
    for (let i = 0; i < MAX_TURNS + 5; i += 1) turns = appendTurn(turns, turn(String(i)));
    expect(turns.length).toBe(MAX_TURNS);
    // The OLDEST go, never the newest.
    expect(turns[turns.length - 1].id).toBe(String(MAX_TURNS + 4));
  });

  test("survives a round trip through storage", () => {
    const turns: ConversationTurn[] = [
      turn("1"),
      { kind: "receipt", id: "2", at: 2, projectId: "p1", text: "Recorded. 50% on EX-01, 02 Sep 2026.", href: "/work-progress" },
      { kind: "gap", id: "3", at: 3, projectId: null, text: "Customers cannot be created here yet", href: "/customers", hrefLabel: "Open Customers" },
    ];
    expect(parseTurns(serialiseTurns(turns))).toEqual(turns);
  });

  test("a blob written by an older version is dropped, never half-rendered", () => {
    expect(parseTurns(null)).toEqual([]);
    expect(parseTurns("not json")).toEqual([]);
    expect(parseTurns(JSON.stringify({ v: 99, turns: [turn("1")] }))).toEqual([]);
    // A receipt with no href cannot be opened, so it is not kept as one.
    expect(parseTurns(JSON.stringify({ v: 1, turns: [{ kind: "receipt", id: "1", at: 1, text: "x" }] }))).toEqual([]);
    // An unknown kind is skipped, and the turns around it survive.
    expect(
      parseTurns(JSON.stringify({ v: 1, turns: [{ kind: "wat", id: "1", at: 1, text: "x" }, turn("2")] }))
    ).toEqual([turn("2")]);
  });

  test("the key is per user, so two people on one browser do not read each other's band", () => {
    expect(conversationKey("Sumeet@Example.com ")).toBe("veri.band2.sumeet@example.com");
    expect(conversationKey(null)).toBe("veri.band2.anonymous");
  });
});

describe("isStale", () => {
  test("a turn made against another project is stale", () => {
    expect(isStale({ kind: "said", id: "1", at: 1, projectId: "p1", text: "x" }, "p2")).toBe(true);
    expect(isStale({ kind: "said", id: "1", at: 1, projectId: "p1", text: "x" }, "p1")).toBe(false);
  });

  test("a turn that was never about a project is never stale", () => {
    expect(isStale({ kind: "said", id: "1", at: 1, projectId: null, text: "x" }, "p2")).toBe(false);
  });
});

describe("paramLabel", () => {
  test("is a word beside the value, never the column name", () => {
    expect(paramLabel("itemCode")).toBe("BOQ line");
    expect(paramLabel("percent")).toBe("Percent complete");
    expect(paramLabel("spentOn")).toBe("Date");
  });

  test("a slot nobody has named yet still reads as words", () => {
    expect(paramLabel("someNewSlot")).toBe("Some new slot");
    expect(paramLabel("boq_line_ref")).toBe("Boq line ref");
  });
});

describe("editInFormRoute", () => {
  test("points at the module screen that owns the write", () => {
    expect(editInFormRoute("record_work_progress", "p1")).toBe("/work-progress?projectId=p1");
    expect(editInFormRoute("record_timesheet", null)).toBe("/schedule/log-time");
  });

  test("is null for a function with no screen -- a link to nowhere is worse than none", () => {
    expect(editInFormRoute("list_leads", "p1")).toBeNull();
    expect(editInFormRoute(null, "p1")).toBeNull();
  });
});
