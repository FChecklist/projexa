/// <reference types="bun-types" />
// R67 D-70. The item's acceptance is a Playwright run with VERIDIAN_API_BASE
// pointed at a closed port, which this lane cannot stage (it may not start a dev
// server), so the same assertions are made here against the component every one
// of the 23 create routes now renders in that situation: the frame survives
// (breadcrumb, title, Back), the banner reads "Couldn't load your project list",
// a Retry control and a Back-to-module link are present, Save is disabled with
// "project list unavailable", and the bare status phrase appears nowhere.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const push = mock((_: string) => {});
const refresh = mock(() => {});
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({ ...realNavigation, useRouter: () => ({ push, refresh }) }));

const CreateScreenUnavailable = (await import("./CreateScreenUnavailable")).default;

afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
});

function renderFailed(message: string | null = "Internal Server Error") {
  return render(
    <CreateScreenUnavailable
      breadcrumb="Drawings & 3D / New Drawing"
      title="New Drawing"
      backHref="/drawings"
      backLabel="Back to Drawings"
      message={message}
    />
  );
}

describe("CreateScreenUnavailable with a failed project-list read", () => {
  test("the screen still renders its own frame -- breadcrumb, title and Back", () => {
    const view = renderFailed();
    expect(view.getByRole("heading", { name: "New Drawing" })).toBeTruthy();
    expect(view.getByText("Drawings & 3D / New Drawing")).toBeTruthy();
    expect(view.getByRole("button", { name: /Back/ })).toBeTruthy();
  });

  test("the banner says what failed, and never shows the bare HTTP status phrase", () => {
    const view = renderFailed();
    expect(view.getByRole("alert").textContent).toContain(
      "Couldn't load your project list: VERIDIAN answered with an internal error."
    );
    expect(document.body.textContent).not.toContain("Internal Server Error");
  });

  test("a real backend message is shown verbatim", () => {
    const view = renderFailed("The construction data service did not respond in time, on two attempts. Please retry.");
    expect(view.getByRole("alert").textContent).toContain(
      "Couldn't load your project list: The construction data service did not respond in time, on two attempts. Please retry."
    );
  });

  test("Retry re-runs the SERVER fetch -- the only thing that can change this screen", () => {
    const view = renderFailed();
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalled();
  });

  test("there is a named way back to the module, not just the browser's back button", () => {
    const view = renderFailed();
    const link = view.getByRole("link", { name: "Back to Drawings" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/drawings");
  });

  test("Save is disabled and states the one reason that outranks every field", () => {
    const view = renderFailed();
    const save = view.getByRole("button", { name: "Save (project list unavailable)" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});

describe("CreateScreenUnavailable with a successful read and no projects", () => {
  test("an empty organisation is not dressed up as an error", () => {
    const view = renderFailed(null);
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("This organisation has no projects yet, so there is nothing to add this to.")).toBeTruthy();
  });

  test("the way out is to create the first project", () => {
    const view = renderFailed(null);
    const link = view.getByRole("link", { name: "Create the first project" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/projects/new");
  });

  test("Save still states a reason, and it is not the failure one", () => {
    const view = renderFailed(null);
    expect(view.getByRole("button", { name: "Save (no project to add this to)" })).toBeTruthy();
  });
});

// The sweep itself: D-70 says "drawings/new/page.tsx AND EVERY OTHER app/*/new
// page that calls the helper". This asserts none of them was left behind --
// otherwise the fix is 22 files deep and the 23rd still shows a bare card.
describe("R67 D-70: every create route that resolves a project renders the framed failure", () => {
  const APP_DIR = path.join(import.meta.dir, "..", "app", "(app)");

  function createPages(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) createPages(full, found);
      else if (entry === "page.tsx" && /[\\/](new|upload|log-time)[\\/]page\.tsx$/.test(full)) found.push(full);
    }
    return found;
  }

  // Walked and read ONCE, at describe scope, where no per-test timeout applies.
  // Both tests below need the same file contents, and doing the walk plus a
  // readFileSync per page inside each of them took 7,390 ms on a full-suite run
  // -- past bun's default 5 s budget, so this failed on a cold CI checkout while
  // passing on a warm local re-run. The lanes merging alongside this one kept
  // adding create routes, which is what pushed it over.
  const pageSources = createPages(APP_DIR).map((file) => ({ file, source: readFileSync(file, "utf8") }));

  /** Generous, because a cold CI checkout reads these off a cold disk. */
  const FILE_SCAN_TIMEOUT_MS = 30_000;

  // R67 MERGE. The sweep looked for ONE helper name and ONE component name, and
  // the merge moved both -- so it was reporting two false offenders and had
  // stopped seeing seven routes entirely. Neither the requirement nor its
  // strength changes here; only the names it recognises.
  //
  //   * A create route resolves its project with resolveSelectedProject OR,
  //     since lane F-19/F-18, with resolveProjectForModule. Seven routes moved
  //     to the second name, which is why the coverage floor below was reading
  //     16 instead of the 20-odd routes that actually exist.
  //   * The framed failure is CreateScreenUnavailable OR CreateProjectMissing,
  //     which is a thin wrapper AROUND CreateScreenUnavailable (see
  //     CreateFormSkeleton.tsx) and whose breadcrumb/title/backHref/backLabel
  //     are REQUIRED props -- so a route that renders it cannot render an
  //     unframed failure, and the compiler holds that, not this string match.
  const RESOLVES_PROJECT = /resolveSelectedProject|resolveProjectForModule/;
  const FRAMED_FAILURE = /CreateScreenUnavailable|CreateProjectMissing/;

  test("no create page returns a bare Card for a failed project resolution", () => {
    expect(existsSync(APP_DIR)).toBe(true);
    const offenders: string[] = [];
    for (const { file, source } of pageSources) {
      if (!RESOLVES_PROJECT.test(source)) continue;
      // drawings/new is the one that never returns early at all (R67 D-08): it
      // always renders DrawingCreateClient, which carries the same banner.
      if (file.includes("drawings")) {
        expect(source).not.toMatch(/if \(errorMessage/);
        continue;
      }
      if (!FRAMED_FAILURE.test(source)) offenders.push(path.relative(APP_DIR, file));
    }
    expect(offenders).toEqual([]);
  }, FILE_SCAN_TIMEOUT_MS);

  test("the sweep actually covered a real number of routes, so an empty walk cannot pass silently", () => {
    const withHelper = pageSources.filter((p) => RESOLVES_PROJECT.test(p.source));
    expect(withHelper.length).toBeGreaterThanOrEqual(20);
  }, FILE_SCAN_TIMEOUT_MS);
});
