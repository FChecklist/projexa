/// <reference types="bun-types" />
// R67 F-09 (R-122). The <Suspense> fallback for /schedule's tab area.
//
// The property worth pinning is the one that distinguishes this from the
// spinner it replaced: it is the SHAPE of the real screen. A reader must be
// able to recognise the page in the first flush, and nothing must move when
// the timeline lands — so the tab labels, the stat-tile labels and the real
// task headers have to be the ones ScheduleGanttClient itself renders.
//
// That last point is what makes this test worth writing rather than obvious:
// the headers here are a hand-copy of another component's, so they can drift
// silently. The final case reads them back off the real client's source and
// fails when the two disagree.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
// `screen` is intentionally not imported: @testing-library/dom binds it to
// document.body at module-evaluation time, before GlobalRegistrator.register()
// has created `document`.
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { ScheduleSkeleton } = await import("./ScheduleSkeleton");

afterEach(cleanup);

const TASK_HEADERS = ["Task", "Start", "Due", "Progress", "Critical Path"];
const TAB_LABELS = ["Timeline", "Board", "Sprints", "Timesheet"];
const TILE_LABELS = ["Tasks", "On Critical Path", "Milestones"];

describe("ScheduleSkeleton", () => {
  test("paints the four real tab labels, so the tab bar does not appear late", () => {
    const { getByText } = render(<ScheduleSkeleton />);

    for (const label of TAB_LABELS) {
      expect(getByText(label)).toBeDefined();
    }
  });

  test("paints the three stat-tile labels with only their numbers pending", () => {
    const { getByText } = render(<ScheduleSkeleton />);

    for (const label of TILE_LABELS) {
      expect(getByText(label)).toBeDefined();
    }
  });

  test("paints the real All-tasks column headers rather than a bare box", () => {
    const { getByText } = render(<ScheduleSkeleton />);

    for (const header of TASK_HEADERS) {
      expect(getByText(header)).toBeDefined();
    }
  });

  test("renders grey rows so the table has height before data lands", () => {
    const { getAllByTestId } = render(<ScheduleSkeleton />);

    expect(getAllByTestId("schedule-loading-row")).toHaveLength(4);
  });

  test("is announced as busy, and says what is loading", () => {
    const { container, getByRole } = render(<ScheduleSkeleton />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(getByRole("status").textContent).toBe("Loading the schedule…");
  });

  test("its column headers still match the ones ScheduleGanttClient renders, in order", () => {
    // A skeleton whose headers have drifted from the real table is worse than
    // no skeleton: the layout jumps at exactly the moment the item set out to
    // keep still. The real client cannot be rendered here (it needs a gantt
    // payload and pulls in SVAR), so its All-tasks header row is read from
    // source instead.
    //
    // Its headers are registry-driven -- `columnLabel(labelColumns, field,
    // fallback)` -- and DEFAULT_COLUMNS supplies text identical to the
    // fallbacks, so the fallback is what a reader sees whenever the registry
    // row is missing, which is precisely when a skeleton is on screen longest.
    // "Progress" is a plain literal in that row and is read as one.
    const source = readFileSync(join(import.meta.dir, "ScheduleGanttClient.tsx"), "utf8");
    const headerRow = source.slice(source.indexOf("<TableHeader>"), source.indexOf("</TableHeader>"));
    expect(headerRow).not.toBe("");

    const rendered = [...headerRow.matchAll(/<TableHead>([\s\S]*?)<\/TableHead>/g)].map(([, inner]) => {
      const viaRegistry = inner.match(/columnLabel\(labelColumns,\s*"[^"]+",\s*"([^"]+)"\)/);
      return viaRegistry ? viaRegistry[1] : inner.trim();
    });

    expect(rendered).toEqual(TASK_HEADERS);
  });
});
