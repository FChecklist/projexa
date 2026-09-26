/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-10. What a person sees of a file that was sent: progress, the result of the reader with its control totals, the
// questions, the choices that unlock the create button, and the ways out of a refusal. The panel is presentation only: every figure comes from
// the job it is given.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { DocumentJobPanel } = await import("./DocumentJobPanel");
import type { DocumentPhase } from "@/hooks/use-document-job";
import { parseJob } from "@/lib/project-from-document-client";

afterEach(cleanup);

const RECON = { status: "shortfall", expected: 1596280, actual: 1388480, difference: 207800, tolerance: 1, source: "reader", byArea: [{ area: "Play Area", expected: 1343445, actual: 1135645, difference: 207800, status: "shortfall" }] };
const QUESTIONS = [
  { kind: "no_rate", sheet: "Table 4", row: 7, text: "Row 7 has a quantity and no rate." },
  { kind: "packed_cell", sheet: "Table 5", row: 3, text: "Several lines share one cell." },
];

function job(over: Record<string, unknown> = {}) {
  return parseJob({ jobId: "j1", state: "needs_answers", fileName: "boq.xlsx", projectId: null, questions: QUESTIONS, reconciliation: RECON, stats: { sheets: 22, rows: 343, lines: 53 }, error: null, updatedAt: "t", ...over });
}
const parked = (over: Record<string, unknown> = {}): DocumentPhase => ({ kind: "parked", job: job(over), fileName: "boq.xlsx" });

function show(phase: DocumentPhase, handlers: { onCreate?: (c: unknown) => void; onReset?: () => void; onAcceptShortfall?: () => void } = {}) {
  return render(
    <DocumentJobPanel phase={phase} onCreate={handlers.onCreate ?? (() => {})} onReset={handlers.onReset ?? (() => {})} onAcceptShortfall={handlers.onAcceptShortfall} projectHref={(id) => `/p/${id}`} />,
  );
}

describe("progress", () => {
  test("idle draws nothing", () => {
    expect(show({ kind: "idle" }).container.innerHTML).toBe("");
  });

  test("sending and reading are announced as status, with the words of the state", () => {
    show({ kind: "sending", fileName: "boq.xlsx" });
    expect(screen.getByRole("status").textContent).toContain("boq.xlsx");
    cleanup();
    show({ kind: "reading", fileName: "boq.xlsx", state: "reading" });
    expect(screen.getByTestId("doc-status").getAttribute("data-state")).toBe("reading");
    expect(screen.getByTestId("doc-status").textContent).toContain("Reading the file");
  });
});

describe("the result of a parked job", () => {
  test("shows what was read, the control totals of the file against the lines, and each question", () => {
    show(parked());
    expect(screen.getByTestId("doc-stats").textContent).toBe("Read 22 sheets, 343 rows, 53 BOQ lines.");
    const totals = screen.getByTestId("doc-totals");
    expect(totals.textContent).toContain("The lines add up to less than the file prints.");
    expect(totals.textContent).toContain("read by the fixed rules of the workbook reader");
    const rows = screen.getAllByTestId("doc-total-row");
    expect(rows[0].textContent).toContain("1,596,280");
    expect(rows[0].textContent).toContain("1,388,480");
    expect(rows[0].textContent).toContain("207,800");
    expect(rows[1].getAttribute("data-area")).toBe("Play Area");
    expect(screen.getAllByTestId("doc-question")).toHaveLength(2);
    expect(screen.getByTestId("doc-questions").textContent).toContain("2 questions need a person");
    expect(screen.getAllByTestId("doc-question")[0].textContent).toContain("Table 4");
    expect(screen.getAllByTestId("doc-question")[0].textContent).toContain("Row 7 has a quantity and no rate.");
  });

  test("a job with open questions and a shortfall cannot be created until the person ticks both, and the reason says which", () => {
    const onCreate = mock(() => {});
    show(parked(), { onCreate });
    const create = screen.getByTestId("doc-create") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(screen.getByTestId("doc-create-reason").textContent).toContain("read the questions");
    act(() => void fireEvent.click(screen.getByTestId("doc-ack-questions")));
    expect((screen.getByTestId("doc-create") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("doc-create-reason").textContent).toContain("less than the file prints");
    act(() => void fireEvent.click(screen.getByTestId("doc-ack-shortfall")));
    expect((screen.getByTestId("doc-create") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("doc-create-reason")).toBeNull();
    act(() => void fireEvent.click(screen.getByTestId("doc-create")));
    expect(onCreate).toHaveBeenCalledWith({ acknowledgeQuestions: true, acknowledgeShortfall: true });
  });

  test("a ready job with matching totals and no questions is created with one click and no acknowledgement", () => {
    const onCreate = mock(() => {});
    show(parked({ state: "ready", questions: [], reconciliation: { ...RECON, status: "matched", actual: 1596280, difference: 0, byArea: [] } }), { onCreate });
    expect(screen.queryByTestId("doc-ack-questions")).toBeNull();
    expect(screen.queryByTestId("doc-ack-shortfall")).toBeNull();
    const create = screen.getByTestId("doc-create") as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    act(() => void fireEvent.click(create));
    expect(onCreate).toHaveBeenCalledWith({ acknowledgeQuestions: false, acknowledgeShortfall: false });
    expect(screen.getByTestId("doc-parked").textContent).toContain("Nothing has been created yet.");
  });

  test("an excess offers no create button at all, and says why", () => {
    show(parked({ questions: [], reconciliation: { ...RECON, status: "excess", actual: 1700000, difference: -103720 } }));
    expect(screen.queryByTestId("doc-create")).toBeNull();
    expect(screen.queryByTestId("doc-ack-shortfall")).toBeNull();
    expect(screen.getByTestId("doc-create-reason").textContent).toContain("more than the file prints");
  });

  test("a file with no totals to check says so and needs nothing but the questions", () => {
    show(parked({ state: "ready", questions: [], reconciliation: { ...RECON, status: "not_checked", expected: null, difference: null, source: "none", byArea: [] } }));
    expect(screen.getByTestId("doc-totals").textContent).toContain("The file prints no total");
    expect((screen.getByTestId("doc-create") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("created", () => {
  test("links to the project and says when the file had already made one", () => {
    show({ kind: "created", projectId: "proj 1", job: job({ state: "created", projectId: "proj 1", questions: [] }), duplicate: false, fileName: "boq.xlsx" });
    expect(screen.getByTestId("doc-created").textContent).toContain("The project was created from the file.");
    expect(screen.getByTestId("doc-open-project").getAttribute("href")).toBe("/p/proj 1");
    cleanup();
    show({ kind: "created", projectId: "p9", job: null, duplicate: true, fileName: "boq.xlsx" });
    expect(screen.getByTestId("doc-created").textContent).toContain("already made a project");
  });
});

describe("refusal", () => {
  test("shows the sentence and the issues of the server and a way to choose another file", () => {
    const onReset = mock(() => {});
    show({ kind: "failed", message: "The workbook holds more text than one extraction reads.", code: "workbook_too_large", issues: ["Sheet Table 9 is too long"], fileName: "boq.xlsx" }, { onReset });
    expect(screen.getByRole("alert").textContent).toContain("The workbook holds more text");
    expect(screen.getByTestId("doc-issues").textContent).toContain("Sheet Table 9 is too long");
    expect(screen.queryByTestId("doc-accept-shortfall")).toBeNull();
    act(() => void fireEvent.click(screen.getByTestId("doc-reset")));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("a refused shortfall offers to read the file again with the shortfall accepted; a refused excess does not", () => {
    const onAccept = mock(() => {});
    show({ kind: "failed", message: "The lines add up to less than the file prints, so nothing was created.", code: "extraction_total_mismatch", issues: [], fileName: "boq.xlsx" }, { onAcceptShortfall: onAccept });
    act(() => void fireEvent.click(screen.getByTestId("doc-accept-shortfall")));
    expect(onAccept).toHaveBeenCalledTimes(1);
    cleanup();
    show({ kind: "failed", message: "The lines add up to more than the file prints, so nothing was created", code: "extraction_total_mismatch", issues: [], fileName: "boq.xlsx" }, { onAcceptShortfall: onAccept });
    expect(screen.queryByTestId("doc-accept-shortfall")).toBeNull();
  });
});
