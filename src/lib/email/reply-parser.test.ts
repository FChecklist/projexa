/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { parseReply, type DigestItemForParsing } from "./reply-parser";

function item(refCode: number, entityType: string, allowedVerbs: string[], consumedAt: Date | null = null): DigestItemForParsing {
  return { refCode, entityType, allowedVerbs, consumedAt };
}

describe("parseReply", () => {
  test("todo: numbered 'done' applies the done verb with no payload", () => {
    const result = parseReply([item(1, "todo", ["done", "note"])], "1 done");
    expect(result.matched).toEqual([{ refCode: 1, entityType: "todo", verb: "done", payloadText: "" }]);
    expect(result.refused).toEqual([]);
  });

  test("todo: unrecognized keyword falls back to the entity's default free-text verb (note)", () => {
    const result = parseReply([item(3, "todo", ["done", "note"])], "3 blocked, waiting on material");
    expect(result.matched).toEqual([{ refCode: 3, entityType: "todo", verb: "note", payloadText: "blocked, waiting on material" }]);
  });

  test("rfi: 'answer:' keyword extracts the rest of the line as the answer payload", () => {
    const result = parseReply([item(2, "rfi", ["answer"])], "2 answer: use grade-40 rebar");
    expect(result.matched).toEqual([{ refCode: 2, entityType: "rfi", verb: "answer", payloadText: "use grade-40 rebar" }]);
  });

  test("rfi: 'close' needs no payload and is only offered when allowed", () => {
    const result = parseReply([item(4, "rfi", ["close"])], "4 close");
    expect(result.matched).toEqual([{ refCode: 4, entityType: "rfi", verb: "close", payloadText: "" }]);
  });

  test("rfi: 'answer' with empty payload is refused as missing_payload, not applied", () => {
    const result = parseReply([item(2, "rfi", ["answer"])], "2 answer");
    expect(result.matched).toEqual([]);
    expect(result.refused).toEqual([{ refCode: 2, reason: "missing_payload", rawLine: "2 answer" }]);
  });

  test("submittal: has no safe default free-text verb -- an unrecognized word is refused, never guessed", () => {
    const result = parseReply([item(5, "submittal", ["approved", "rejected"])], "5 looks fine to me");
    expect(result.matched).toEqual([]);
    expect(result.refused).toEqual([{ refCode: 5, reason: "verb_not_recognized", rawLine: "5 looks fine to me" }]);
    expect(result.unmatchedText).toBe("5 looks fine to me");
  });

  test("submittal: 'reject' requires the reason text", () => {
    const result = parseReply([item(5, "submittal", ["approved", "rejected"])], "5 reject: wrong spec section");
    expect(result.matched).toEqual([{ refCode: 5, entityType: "submittal", verb: "rejected", payloadText: "wrong spec section" }]);
  });

  test("punch_list: 'ready' and 'verify' are only matched if allowed on this item", () => {
    const openItem = item(6, "punch_list", ["ready"]);
    const readyForReviewItem = item(6, "punch_list", ["verify"]);
    expect(parseReply([openItem], "6 verify").matched).toEqual([]);
    expect(parseReply([openItem], "6 verify").refused[0].reason).toBe("verb_not_recognized");
    expect(parseReply([readyForReviewItem], "6 verify").matched).toEqual([{ refCode: 6, entityType: "punch_list", verb: "verify", payloadText: "" }]);
  });

  test("billing_milestone: 'submit'", () => {
    const result = parseReply([item(7, "billing_milestone", ["submit"])], "7 submitted");
    expect(result.matched).toEqual([{ refCode: 7, entityType: "billing_milestone", verb: "submit", payloadText: "" }]);
  });

  test("unknown ref code -> refused and kept in unmatchedText (visible to a human, never dropped)", () => {
    const result = parseReply([item(1, "todo", ["done"])], "9 done");
    expect(result.matched).toEqual([]);
    expect(result.refused).toEqual([{ refCode: 9, reason: "unknown_ref_code", rawLine: "9 done" }]);
    expect(result.unmatchedText).toBe("9 done");
  });

  test("already-consumed item -> refused, NOT re-applied, and not re-added to unmatchedText (it's already been handled)", () => {
    const result = parseReply([item(1, "todo", ["done"], new Date())], "1 done");
    expect(result.matched).toEqual([]);
    expect(result.refused).toEqual([{ refCode: 1, reason: "already_consumed", rawLine: "1 done" }]);
    expect(result.unmatchedText).toBe("");
  });

  test("lines with no leading number become free-form unmatched text, joined", () => {
    const result = parseReply([item(1, "todo", ["done"])], "1 done\nAlso, tomorrow I'm starting the electrical rough-in.\nNeed more cement delivered.");
    expect(result.matched).toEqual([{ refCode: 1, entityType: "todo", verb: "done", payloadText: "" }]);
    expect(result.unmatchedText).toBe("Also, tomorrow I'm starting the electrical rough-in.\nNeed more cement delivered.");
  });

  test("quoted reply lines (client didn't strip quoting) are skipped as a second line of defense", () => {
    const result = parseReply([item(1, "todo", ["done"])], "1 done\n> On Mon, PROJEXA wrote:\n> Here's what's on your plate today");
    expect(result.matched).toEqual([{ refCode: 1, entityType: "todo", verb: "done", payloadText: "" }]);
    expect(result.unmatchedText).toBe("");
  });

  test("empty/whitespace-only lines are ignored entirely", () => {
    const result = parseReply([item(1, "todo", ["done"])], "\n\n1 done\n   \n");
    expect(result.matched).toEqual([{ refCode: 1, entityType: "todo", verb: "done", payloadText: "" }]);
    expect(result.unmatchedText).toBe("");
  });
});
