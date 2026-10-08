import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { csvEscape, csvFilename, toCsv } from "@/lib/csv-export";
import { describeExtensions, describeFileSize, fileExtension, fileSizeError, fileTypeError } from "@/lib/file-limits";
import { createFakeSyncServer } from "@/lib/local-first/__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "@/lib/local-first/local-db";
import { createOutbox, OutboxRefusal } from "@/lib/local-first/outbox";
import { MAX_OP_CHARS, MAX_TEXT_CHARS, cleanedLength, opTooLarge, textLimitProblem } from "@/lib/local-first/outbox-words";
import { normaliseMaterialUnit, isMaterialUnit, materialUnitLabel } from "@/lib/material-units";
import { missingProjectFields, projectSaveDisabledReason } from "@/lib/project-form";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { addDaysIso, dueDateError, dueDateFromDuration, durationFieldValue, activitySaveLabel, missingActivityFields } from "@/lib/schedule-activity";
import { HOURS_INVALID_MESSAGE, hoursError, missingFields, saveLabel, timeLoggedReceipt } from "@/lib/time-entry";
import { QUANTITY_TOO_SMALL_MESSAGE, issueQuantityError, onHandLimitMessage, pluraliseUnit } from "@/lib/unit-label";

// MATRIX category 3: input validation, output shape, and the data input -> output -> storage path. Cases M03-01 ... M03-40.

describe("M03 input validation", () => {
  test.each([["", true], ["0.25", true], ["7.5", true], ["24", true], ["24.25", false], ["0", false], ["-1", false], ["abc", false], ["0.3", false], ["1e1", true], ["Infinity", false]])(
    "M03-01 hours %p valid=%p", (raw, ok) => { expect(hoursError(raw) === null).toBe(ok); if (!ok) expect(hoursError(raw)).toBe(HOURS_INVALID_MESSAGE); });
  test("M03-02 time form lists what is missing in screen order and the Save label shows it", () => {
    const m = missingFields({ issueId: "", hours: "", spentOn: "", category: null });
    expect(m).toEqual(["Task", "Hours", "Date", "Category"]);
    expect(saveLabel(m)).toBe("Save (4 required: Task, Hours, Date, Category)");
    expect(saveLabel([])).toBe("Save");
    expect(saveLabel([], { blocked: "Enter hours" })).toBe("Save (Enter hours)");
    expect(saveLabel([], { submitting: true })).toBe("Save (Logging…)");
  });
  test("M03-03 receipt is built from the stored row: two-decimal hours, task number and title", () => {
    expect(timeLoggedReceipt({ hours: "3", spentOn: "2026-09-02", taskNumber: 12, taskTitle: "Joinery" })).toContain("3.00 h on #12 Joinery");
  });
  test("M03-04 project form: both required fields named, whitespace-only counts as empty", () => {
    expect(missingProjectFields({ productId: " ", name: "" })).toEqual(["Product", "Project Name"]);
    expect(missingProjectFields({ productId: "p", name: "  x " })).toEqual([]);
    expect(projectSaveDisabledReason([], true)).toBe("Saving…");
    expect(projectSaveDisabledReason(["Product"], false)).toBe("Product");
    expect(projectSaveDisabledReason([], false)).toBeUndefined();
  });
  test("M03-05 activity form: count while several are missing, the name when one is left", () => {
    expect(activitySaveLabel(missingActivityFields({ title: "", startDate: "", dueDate: "" }))).toBe("Save (2 required fields)");
    expect(activitySaveLabel(missingActivityFields({ title: "x", startDate: "", dueDate: "" }))).toBe("Save (Start date is required)");
    expect(activitySaveLabel(missingActivityFields({ title: "x", startDate: "2026-10-01", dueDate: "" }))).toBe("Save");
  });
  test("M03-06 due date before start is refused with a plain sentence; empty or equal dates are fine", () => {
    expect(dueDateError("2026-10-10", "2026-10-09")).toContain("before the start date");
    expect(dueDateError("2026-10-10", "2026-10-10")).toBeNull();
    expect(dueDateError("", "2026-10-10")).toBeNull();
    expect(dueDateError("2026-10-10", "")).toBeNull();
  });
  test("M03-07 duration <-> due date round trip, including a month end and a leap day", () => {
    expect(dueDateFromDuration("2026-10-28", "5")).toBe("2026-11-02");
    expect(dueDateFromDuration("2028-02-27", "2")).toBe("2028-02-29");
    expect(durationFieldValue("2026-10-28", "2026-11-02")).toBe("5");
    expect(durationFieldValue("", "2026-11-02")).toBe("");
    expect(dueDateFromDuration("2026-10-28", "-3")).toBeNull();
    expect(dueDateFromDuration("2026-10-28", "abc")).toBeNull();
    expect(dueDateFromDuration("2026-10-28", " ")).toBeNull();
    expect(addDaysIso("not a date", 3)).toBeNull();
  });
  test.each([["", undefined], ["0", QUANTITY_TOO_SMALL_MESSAGE], ["-3", QUANTITY_TOO_SMALL_MESSAGE], ["abc", QUANTITY_TOO_SMALL_MESSAGE], ["5", undefined], ["10", undefined], ["11", "Only 10 bags on hand"]])(
    "M03-08 issue quantity %p against 10 bags on hand -> %p", (raw, want) => { expect(issueQuantityError(raw, 10, "bag")).toBe(want); });
  test("M03-09 issue quantity with no material chosen only applies the >0 rule", () => {
    expect(issueQuantityError("999", null, null)).toBeUndefined();
    expect(issueQuantityError("0", null, null)).toBe(QUANTITY_TOO_SMALL_MESSAGE);
  });
  test("M03-10 units read naturally: singular at 1, invariant units stay, plural otherwise", () => {
    expect(pluraliseUnit("bag", 1)).toBe("bag");
    expect(pluraliseUnit("bag", 2)).toBe("bags");
    expect(pluraliseUnit("kg", 2)).toBe("kg");
    expect(pluraliseUnit("", 2)).toBe("");
    expect(pluraliseUnit(null, 2)).toBe("");
    expect(onHandLimitMessage(1, "bag")).toBe("Only 1 bag on hand");
    expect(onHandLimitMessage(3, null)).toBe("Only 3 on hand");
  });
  test("M03-11 material units: case, plural and unknown handling; unknown legacy units are shown as stored", () => {
    expect(normaliseMaterialUnit("KG")).not.toBeUndefined();
    expect(normaliseMaterialUnit("zzz-unit")).toBeNull();
    expect(normaliseMaterialUnit(null)).toBeNull();
    expect(isMaterialUnit("zzz-unit")).toBe(false);
    expect(materialUnitLabel("zzz-unit")).toBe("zzz-unit");
    expect(materialUnitLabel(null)).toBe("");
  });
  test.each([[1, 10, undefined], [10 * 1024 * 1024, 10, undefined], [10 * 1024 * 1024 + 1, 10, "This file is 10.0 MB; the limit is 10 MB"], [25 * 1024 * 1024, 10, "This file is 25 MB; the limit is 10 MB"], [null, 10, undefined]])(
    "M03-12 file size %p vs %p MB", (bytes, limit, want) => { expect(fileSizeError(bytes as number | null, limit)).toBe(want); });
  test.each([["a.pdf", undefined], ["A.PDF", undefined], ["a.png", "Choose a .dwg, .dxf or .pdf file — this is a .png"], ["noext", "Choose a .dwg, .dxf or .pdf file"], ["archive.tar.pdf", undefined], [null, undefined]])(
    "M03-13 file name %p against .dwg/.dxf/.pdf", (name, want) => { expect(fileTypeError(name as string | null, [".dwg", ".dxf", ".pdf"])).toBe(want); });
  test("M03-14 extension helpers", () => {
    expect(fileExtension("DEWA_permit_2026.PDF")).toBe(".pdf");
    expect(fileExtension("x")).toBe("");
    expect(describeExtensions([".pdf"])).toBe(".pdf");
    expect(describeExtensions([])).toBe("");
    expect(describeFileSize(5 * 1024 * 1024, 10)).toBe("5 MB");
  });
  test.each([
    ["/dashboard", "/dashboard"], ["/invite/abc?x=1", "/invite/abc?x=1"], ["//evil.example", "/dashboard"], ["/\\evil.example", "/dashboard"], ["https://evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"], ["/login", "/dashboard"], ["/login/x", "/dashboard"], ["/signup?a=1", "/dashboard"], ["/a\nb", "/dashboard"], ["", "/dashboard"], [null, "/dashboard"], [undefined, "/dashboard"], ["  /ok  ", "/ok"],
  ])("M03-15 post-sign-in redirect %p -> %p", (raw, want) => { expect(safeRedirectPath(raw as string | null | undefined)).toBe(want); });
  test("M03-16 redirect fallback is honoured", () => { expect(safeRedirectPath("//x", "/home")).toBe("/home"); });
});

describe("M03 output shape (CSV the user downloads)", () => {
  test("M03-17 commas, quotes and newlines are quoted; embedded quotes doubled", () => {
    expect(csvEscape('Slab, 150mm "A"')).toBe('"Slab, 150mm ""A"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
  test("M03-18 null and undefined are empty cells; 0 and false are kept", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
    expect(csvEscape(0)).toBe("0");
    expect(csvEscape(false)).toBe("false");
  });
  test.each(["=1+1", "+cmd", "@SUM(A1)", "\tx", "-cmd|' /C calc'!A0"])("M03-19 formula-injection text %p is neutralised", (v) => {
    expect(csvEscape(v).startsWith("'") || csvEscape(v).startsWith('"\'')).toBe(true);
  });
  test("M03-20 a NEGATIVE NUMBER (a variance, a credit) stays a number in the export, not text with an apostrophe", () => {
    expect(csvEscape(-30)).toBe("-30");
    expect(csvEscape(-0.5)).toBe("-0.5");
    expect(toCsv(["Variance"], [[-1250.75]]).split("\r\n")[1]).toBe("-1250.75");
  });
  test("M03-21 CRLF rows, header first, column count stable even with nulls", () => {
    const out = toCsv(["a", "b", "c"], [[1, null, "x"], [undefined, 2, ""]]);
    expect(out).toBe("a,b,c\r\n1,,x\r\n,2,");
  });
  test("M03-22 file name slug: spaces, slashes and symbols become single dashes; empty label falls back", () => {
    expect(csvFilename("roster", "Cedar Heights / Villa (Phase 1)", "2026-10-08")).toBe("roster-cedar-heights-villa-phase-1-2026-10-08.csv");
    expect(csvFilename("roster", "!!!", "2026-10-08")).toBe("roster-export-2026-10-08.csv");
  });
});

describe("M03 input -> output -> storage", () => {
  test("M03-23 text limit counts the text after the server's own cleaning", () => {
    expect(cleanedLength("abc")).toBe(3);
    expect(textLimitProblem({ title: "x".repeat(MAX_TEXT_CHARS) })).toBeNull();
    expect(textLimitProblem({ title: "x".repeat(MAX_TEXT_CHARS + 1) })).toMatchObject({ field: "title", limit: MAX_TEXT_CHARS });
  });
  test("M03-24 a number or an unknown field is never judged by the text limit", () => {
    expect(textLimitProblem({ amount: 1e9, blob: "x".repeat(5000) })).toBeNull();
  });
  test("M03-25 an oversized operation is flagged, a normal one is not", () => {
    expect(opTooLarge({ a: "x".repeat(100) })).toBe(false);
    expect(opTooLarge({ a: "x".repeat(MAX_OP_CHARS + 10) })).toBe(true);
  });

  async function rig() {
    const s = createFakeSyncServer({ strict: true });
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
    s.registerFunction("update_task", ({ target, params }) => {
      if (!target) return { rejected: "RECORD_NOT_FOUND" };
      const { issueId: _i, ...rest } = params as Record<string, unknown>;
      return { ok: true, kind: "tasks", id: target.id, data: { ...target.data, ...rest } };
    });
    const idb = new IDBFactory();
    const { createReplica } = await import("@/lib/local-first/replica");
    await createReplica({ userId: "u1", client: s.client, idb, yieldFn: async () => {} }).sync();
    let n = 0;
    const outbox = createOutbox({ userId: "u1", client: s.client, deviceId: "device-aaaa", idb, sleep: async () => {}, autoFlush: false, newOpId: () => `matrix-op-${++n}`, locks: null });
    return { s, idb, outbox };
  }
  const editWith = (o: ReturnType<typeof createOutbox>, title: string) =>
    o.enqueue({
      functionId: "update_task", projectId: "p1", params: { issueId: "t1", title }, record: { kind: "tasks", id: "t1", baseVersion: 1 },
      optimistic: async (tx) => { const r = (await tx.getRecord("tasks", "t1"))!; await tx.patchRecord("tasks", "t1", { data: { ...(r.data as object), title } }); },
    });

  test("M03-26 a too-long text is refused BEFORE anything is stored (nothing half-saved)", async () => {
    const { outbox, idb } = await rig();
    await expect(editWith(outbox, "x".repeat(MAX_TEXT_CHARS + 1))).rejects.toBeInstanceOf(OutboxRefusal);
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect(await db.listOps()).toEqual([]);
    expect((await db.getRecord("tasks", "t1"))!.data).toMatchObject({ title: "Old" });
    db.close();
  });
  test("M03-27 text of exactly the limit is accepted", async () => {
    const { outbox } = await rig();
    await expect(editWith(outbox, "x".repeat(MAX_TEXT_CHARS))).resolves.toHaveProperty("opId");
  });
  test("M03-28 refusal carries a code and the field name for the screen", async () => {
    const { outbox } = await rig();
    const err = await editWith(outbox, "y".repeat(MAX_TEXT_CHARS + 5)).catch((e) => e as OutboxRefusal);
    expect(err).toMatchObject({ code: "TEXT_TOO_LONG", field: "title" });
  });
  test("M03-29 unicode survives input -> laptop -> server -> back (Arabic, Hindi, emoji)", async () => {
    const { outbox, s } = await rig();
    const text = "مشروع الفيلا - परियोजना - 🏗️";
    await editWith(outbox, text);
    await outbox.flush();
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: text });
  });
  test("M03-30 quotes, angle brackets and backslashes are stored as typed, not altered", async () => {
    const { outbox, s } = await rig();
    const text = `He said "hi" <b>x</b> C:\\path 'q'`;
    await editWith(outbox, text);
    await outbox.flush();
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: text });
  });
  test("M03-31 stored op keeps exactly what was typed (params) until it is delivered", async () => {
    const { outbox, idb } = await rig();
    await editWith(outbox, "Typed text");
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.listOps())[0]).toMatchObject({ functionId: "update_task", status: "pending", params: { issueId: "t1", title: "Typed text" } });
    db.close();
  });
  test("M03-32 delivered edit: laptop row == server row (same title, version 2), op removed, nothing dirty", async () => {
    const { outbox, idb, s } = await rig();
    await editWith(outbox, "Round trip");
    await outbox.flush();
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    const r = (await db.getRecord("tasks", "t1"))!;
    expect(r.data).toMatchObject({ title: "Round trip" });
    expect(r.serverVersion).toBe(s.getRow("tasks", "t1")!.version);
    expect(await db.listOps()).toEqual([]);
    expect(await db.listDirty()).toEqual([]);
    db.close();
  });
  test("M03-33 the same title typed twice is two real edits, each with its own op id, but the server ends with the one value", async () => {
    const { outbox, s } = await rig();
    const a = await editWith(outbox, "Same");
    const b = await editWith(outbox, "Same");
    expect(a.opId).not.toBe(b.opId);
    await outbox.flush();
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: "Same" });
  });
  test("M03-34 editing a row the laptop does not have is rejected as input, not stored as a ghost", async () => {
    const { outbox, idb } = await rig();
    await outbox.enqueue({ functionId: "update_task", projectId: "p1", params: { issueId: "nope", title: "x" }, record: { kind: "tasks", id: "nope", baseVersion: 1 } }).catch(() => {});
    await outbox.flush();
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect(await db.getRecord("tasks", "nope")).toBeUndefined();
    db.close();
  });
  test("M03-35 empty project id or bad base version is refused at the door", async () => {
    const { outbox } = await rig();
    await expect(outbox.enqueue({ functionId: "update_task", projectId: "", params: {} })).rejects.toThrow();
    await expect(outbox.enqueue({ functionId: "update_task", projectId: "p1", params: {}, record: { kind: "tasks", id: "t1", baseVersion: Number.NaN } })).rejects.toThrow();
  });
  test("M03-36 many fast edits to one field: the server ends with the LAST one", async () => {
    const { outbox, s } = await rig();
    for (const t of ["a", "b", "c", "d", "e"]) await editWith(outbox, t);
    await outbox.flush();
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: "e" });
  });
  test("M03-37 a large batch of separate edits (200 ops) is delivered completely and in more than one push if needed", async () => {
    const { outbox, s, idb } = await rig();
    for (let i = 0; i < 200; i++) s.upsert({ kind: "tasks", projectId: "p1", id: `x${i}`, data: { title: `x${i}` } });
    const { createReplica } = await import("@/lib/local-first/replica");
    await createReplica({ userId: "u1", client: s.client, idb, yieldFn: async () => {} }).sync();
    for (let i = 0; i < 200; i++) {
      await outbox.enqueue({
        functionId: "update_task", projectId: "p1", params: { issueId: `x${i}`, title: `new${i}` }, record: { kind: "tasks", id: `x${i}`, baseVersion: 1 },
        optimistic: async (tx) => { const r = (await tx.getRecord("tasks", `x${i}`))!; await tx.patchRecord("tasks", `x${i}`, { data: { ...(r.data as object), title: `new${i}` } }); },
      });
    }
    for (let k = 0; k < 6 && (await outbox.pendingCount()) > 0; k++) await outbox.flush();
    expect(await outbox.pendingCount()).toBe(0);
    expect(s.getRow("tasks", "x199")!.data).toMatchObject({ title: "new199" });
    expect(s.getRow("tasks", "x0")!.data).toMatchObject({ title: "new0" });
  });
});
