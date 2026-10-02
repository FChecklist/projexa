import { describe, expect, test } from "bun:test";
import { MAX_OP_CHARS, cleanedLength, opTooLarge, pgJsonLength, syncCodeSentence, textLimitProblem, textTooLongMessage } from "./outbox-words";

// The outbox's own words and its two size rules (the server's 2,000-character text rule and 0681's 64 KB per-op ceiling).

describe("the text rule, counted the way the server counts it", () => {
  test("2,000 characters pass and 2,001 are refused, naming the field", () => {
    expect(textLimitProblem({ question: "q".repeat(2000) })).toBeNull();
    expect(textLimitProblem({ projectId: "p1", question: "q".repeat(2001) })).toEqual({ field: "question", length: 2001, limit: 2000 });
  });

  test("invisible characters do not count (the server removes them first) and a backtick run counts as two characters", () => {
    expect(cleanedLength("a​‮b\u0007")).toBe(2);
    expect(cleanedLength("x```````y")).toBe(4);
    expect(textLimitProblem({ answer: "a".repeat(2000) + "​".repeat(50) })).toBeNull();
    expect(cleanedLength("line one\nline\ttwo")).toBe(17); // tab and newline stay
  });

  test("only free-text parameters are checked (an id or a date never is)", () => {
    expect(textLimitProblem({ issueId: "x".repeat(5000), description: "short" })).toBeNull();
    expect(textLimitProblem({ title: "t", description: "d".repeat(2500) })).toMatchObject({ field: "description" });
  });

  test("the message names the field and the limit in words, never the parameter's code name", () => {
    const m = textTooLongMessage({ field: "fileLabel", length: 2501, limit: 2000 });
    expect(m).toContain("file label");
    expect(m).toContain("2,501");
    expect(m).toContain("2,000");
    expect(m).toContain("Your text is kept");
    expect(m).not.toContain("fileLabel");
  });
});

describe("the per-op ceiling (0681: length(p_op::text) > 65536)", () => {
  test("lengths are counted as Postgres prints jsonb: ', ' and ': ' separators", () => {
    expect(pgJsonLength({ a: 1, b: [1, 2] })).toBe('{"a": 1, "b": [1, 2]}'.length);
    expect(pgJsonLength({})).toBe(2);
    expect(pgJsonLength({ s: "é" })).toBe('{"s": "é"}'.length);
  });

  test("an op just under the ceiling passes; just over is too large", () => {
    const base = { op_id: "o", params: { description: "" } };
    const room = MAX_OP_CHARS - pgJsonLength(base);
    expect(opTooLarge({ op_id: "o", params: { description: "x".repeat(room) } })).toBe(false);
    expect(opTooLarge({ op_id: "o", params: { description: "x".repeat(room + 1) } })).toBe(true);
  });
});

describe("the sync service's own codes", () => {
  test("each has its own sentence; an unknown code has none (task-errors' dictionary decides)", () => {
    const codes = ["TEXT_TOO_LONG", "ROLE_TOO_LOW", "FUNCTION_NOT_ALLOWED", "PROJECT_NOT_READABLE", "OP_ID_REUSED", "BAD_OP", "CAP_DAY"];
    const sentences = codes.map(syncCodeSentence);
    for (const s of sentences) expect(s).toBeTruthy();
    expect(new Set(sentences).size).toBe(codes.length);
    expect(syncCodeSentence("SOMETHING_ELSE")).toBeNull();
    expect(syncCodeSentence(undefined)).toBeNull();
  });
});
