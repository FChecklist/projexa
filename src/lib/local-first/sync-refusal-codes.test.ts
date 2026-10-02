import { describe, expect, test } from "bun:test";
import { rejectionMessage } from "./outbox";
import { asTaskErrorCode } from "@/lib/task-errors";

// LOCAL-FIRST review F11 (wire conformance harness W21): the permanent refusals the sync service really sends for a pushed change
// (compliance-tracker drizzle/0681 projexa_sync_push_begin, supabase/functions/projexa-sync/handler.ts push()) must reach the person in
// true words, never the generic "The server did not accept it". The dictionary is task-errors.ts; outbox.ts only picks the sentence.

const op = { functionId: "update_task", label: "Your change to this task" };
const generic = rejectionMessage(op, { code: "A_CODE_NOBODY_SENDS" });

describe("the sync service's refusal codes have their own sentences", () => {
  const cases: [code: string, words: RegExp][] = [
    ["ROLE_TOO_LOW", /role does not allow/i],
    ["PROJECT_NOT_READABLE", /do not have access to that project/i],
    ["FUNCTION_NOT_ALLOWED", /cannot be saved from the laptop copy/i],
    ["CAP_DAY", /today's limit/i],
    ["BAD_OP", /not accepted as entered/i],
    ["OP_ID_REUSED", /not accepted as entered/i],
  ];
  for (const [code, words] of cases) {
    test(`${code}`, () => {
      const message = rejectionMessage(op, { code });
      expect(message).not.toBe(generic);
      expect(message).toMatch(words);
      expect(message).toMatch(/^Your change to this task was not saved\. .* It was undone on this laptop\.$/);
      expect(message).not.toContain(code); // a code is never shown to a person
    });
  }

  test("lower-case codes resolve the same way, and an unknown code still gets the honest fallback", () => {
    expect(asTaskErrorCode("cap_day")).toBe("DAILY_LIMIT_REACHED");
    expect(generic).toContain("The server did not accept it");
  });
});
