import { describe, expect, test } from "bun:test";
import { beforeOf, decide, effectFromParams, effectOf, fieldValue, isProtectedField, overlay, same, withoutFields } from "./outbox-merge";

// R12: the field-level three-way merge, as pure functions (outbox.test / outbox-safety.test drive it through the engine).

describe("the pieces", () => {
  test("effectOf is exactly the keys the optimistic change touched (a removed key reads as null)", () => {
    expect(effectOf({ title: "Old", status_id: "s1", n: 1, gone: "x" }, { title: "New", status_id: "s1", n: 1, statusId: "s2" }))
      .toEqual({ title: "New", statusId: "s2", gone: null });
    expect(effectOf({ a: { b: 1 } }, { a: { b: 1 } })).toEqual({}); // deep-equal values are not a change
  });

  test("beforeOf reads the same keys from before the change", () => {
    expect(beforeOf({ title: "Old" }, { title: "New", statusId: "s2" })).toEqual({ title: "Old", statusId: null });
  });

  test("a field is the same under its camelCase and snake_case names", () => {
    expect(fieldValue({ status_id: "s1" }, "statusId")).toBe("s1");
    expect(fieldValue({ dueDate: "d" }, "due_date")).toBe("d");
    expect(fieldValue({}, "x")).toBeUndefined();
    expect(same(undefined, null)).toBe(true);
    expect(same({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  test("overlay writes each field under the name the row already uses", () => {
    expect(overlay({ title: "T", status_id: "s1", x: 1 }, { statusId: "s9", title: "M", fresh: true }))
      .toEqual({ title: "M", status_id: "s9", x: 1, fresh: true });
  });

  test("money and approval fields are recognised", () => {
    for (const k of ["amount", "unitRate", "contract_value", "budget", "approvalStatus", "approved_by", "totalCost", "signOff"]) expect(isProtectedField(k)).toBe(true);
    for (const k of ["title", "description", "statusId", "dueDate", "answer", "priority"]) expect(isProtectedField(k)).toBe(false);
  });

  test("effectFromParams (ops made before schema 4) drops the project and the target id; withoutFields drops either spelling", () => {
    expect(effectFromParams({ projectId: "p1", issueId: "t1", title: "x", statusId: "s2" }, "t1")).toEqual({ title: "x", statusId: "s2" });
    expect(withoutFields({ projectId: "p1", issueId: "t1", title: "x", statusId: "s2" }, ["status_id"])).toEqual({ projectId: "p1", issueId: "t1", title: "x" });
  });
});

describe("decide: the three-way rule", () => {
  test("fields only ONE side changed merge silently: theirs keeps their field, mine keeps mine", () => {
    const d = decide({ effect: { title: "Mine" }, before: { title: "Old" }, theirs: { title: "Old", status_id: "s2" } });
    expect(d).toEqual({ kind: "merged", data: { title: "Mine", status_id: "s2" } });
  });

  test("the same field changed by both sides to DIFFERENT values is a card, naming only that field", () => {
    const d = decide({ effect: { title: "Mine", priority: "high" }, before: { title: "Old", priority: "low" }, theirs: { title: "Theirs", priority: "low" } });
    expect(d).toEqual({ kind: "card", fields: ["title"] });
  });

  test("both sides changed it to the SAME value: nothing to decide", () => {
    expect(decide({ effect: { title: "Same" }, before: { title: "Old" }, theirs: { title: "Same", other: 1 } })).toEqual({ kind: "already_in" });
  });

  test("snake_case server rows are compared under the camelCase edit's names", () => {
    expect(decide({ effect: { statusId: "s2" }, before: { statusId: "s1" }, theirs: { status_id: "s1", title: "T2" } }))
      .toEqual({ kind: "merged", data: { status_id: "s2", title: "T2" } });
    expect(decide({ effect: { statusId: "s2" }, before: { statusId: "s1" }, theirs: { status_id: "s3" } })).toEqual({ kind: "card", fields: ["statusId"] });
  });

  test("an unknown base never merges: a field theirs differs on goes to the card", () => {
    expect(decide({ effect: { title: "Mine" }, theirs: { title: "Old" } })).toEqual({ kind: "card", fields: ["title"] });
  });

  test("a money or approval field is never merged on the laptop, even when only the person changed it", () => {
    expect(decide({ effect: { amount: 500, title: "Mine" }, before: { amount: 100, title: "Old" }, theirs: { amount: 100, title: "Old", x: 2 } }))
      .toEqual({ kind: "card", fields: ["amount", "title"] });
  });
});
