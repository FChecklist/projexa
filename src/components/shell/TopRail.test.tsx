/// <reference types="bun-types" />
// R67 D-66 / D-04. The rail's project control used to CYCLE: one click
// advanced to the next project and clicking past the end landed on "All
// projects". With five projects, reaching the third cost three clicks and
// there was never a moment at which the user could see the list they were
// choosing from -- while the control itself rendered a "▾" promising a menu
// that never opened.
//
// M24 calls this the most expensive control in the product to get wrong, so
// these assertions are about the thing that makes it wrong-proof: the
// options are visible before you commit to one.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ALL_PROJECTS_LABEL, TopRail, type TopRailProject } from "./TopRail";

afterEach(cleanup);

const PROJECTS: TopRailProject[] = [
  { id: "p-cedar", name: "Cedar Heights Villa - Phase 1" },
  { id: "p-villa21", name: "Villa 21" },
  { id: "p-marina", name: "Marina Tower" },
];

function renderRail(overrides: Partial<Parameters<typeof TopRail>[0]> = {}) {
  const chosen: (TopRailProject | null)[] = [];
  const utils = render(
    <TopRail
      brand={<span>PROJEXA</span>}
      organisationName="Skyline Builders"
      project={PROJECTS[1]}
      projects={PROJECTS}
      onSelectProject={(p) => chosen.push(p)}
      {...overrides}
    />
  );
  return { ...utils, chosen };
}

describe("TopRail project picker", () => {
  test("the list is closed until asked for, and the rail shows the current project", () => {
    const { container, queryByRole } = renderRail();
    expect(container.textContent).toContain("Villa 21");
    expect(queryByRole("listbox")).toBeNull();
  });

  test("one click opens a real list -- every project at once, not the next one", () => {
    const { getByRole, getAllByRole } = renderRail();
    fireEvent.click(getByRole("button", { name: /Click to switch project/ }));

    const options = getAllByRole("option").map((o) => (o.textContent ?? "").trim());
    // "All projects" first: M24's null state is how org-level work stays
    // reachable, so it cannot be buried at the bottom of the list.
    expect(options[0]).toBe(ALL_PROJECTS_LABEL);
    expect(options).toEqual([
      "All projects",
      "Cedar Heights Villa - Phase 1",
      "✓Villa 21",
      "Marina Tower",
    ]);
    expect(getByRole("listbox")).toBeDefined();
  });

  test("the current project is marked for a screen reader, not only tinted", () => {
    const { getByRole, getAllByRole } = renderRail();
    fireEvent.click(getByRole("button", { name: /Click to switch project/ }));
    const selected = getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect((selected[0].textContent ?? "").trim()).toContain("Villa 21");
  });

  test("choosing a project reports THAT project -- not the next one in the array", () => {
    const { getByRole, getAllByRole, chosen } = renderRail();
    fireEvent.click(getByRole("button", { name: /Click to switch project/ }));
    const marina = getAllByRole("option").find((o) => (o.textContent ?? "").includes("Marina Tower"))!;
    fireEvent.click(marina);
    expect(chosen).toEqual([{ id: "p-marina", name: "Marina Tower" }]);
  });

  test("'All projects' reports null, which is the explicit org-wide state", () => {
    const { getByRole, getAllByRole, chosen } = renderRail();
    fireEvent.click(getByRole("button", { name: /Click to switch project/ }));
    fireEvent.click(getAllByRole("option")[0]);
    expect(chosen).toEqual([null]);
  });

  test("the list closes after a choice, so it cannot sit over the screen the user just switched to", () => {
    const { getByRole, getAllByRole, queryByRole } = renderRail();
    fireEvent.click(getByRole("button", { name: /Click to switch project/ }));
    fireEvent.click(getAllByRole("option")[0]);
    expect(queryByRole("listbox")).toBeNull();
  });

  test("Escape closes it without choosing anything", () => {
    const { getByRole, queryByRole, chosen } = renderRail();
    fireEvent.click(getByRole("button", { name: /Click to switch project/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(queryByRole("listbox")).toBeNull();
    expect(chosen).toEqual([]);
  });

  test("with no project chosen the rail says so in M24's own words", () => {
    const { container } = renderRail({ project: null });
    expect(container.textContent).toContain(ALL_PROJECTS_LABEL);
  });

  test("an empty project list says why rather than opening a blank menu", () => {
    const { getByRole, container } = renderRail({ projects: [], project: null });
    fireEvent.click(getByRole("button", { name: /Click to choose a project/ }));
    expect(container.textContent).toContain("No projects to switch to yet.");
  });
});

// OWNER FIX, 2026-09-14 -- "+ Add new project" at the end of this same list.
describe("TopRail '+ Add new project'", () => {
  test("omitted by default -- a caller that doesn't pass onCreateProject renders exactly as before", () => {
    const { getByRole, queryByText } = renderRail();
    fireEvent.click(getByRole("button", { name: /Click to switch project/ }));
    expect(queryByText("Add new project")).toBeNull();
  });

  test("renders last, after every real project, when the caller wires it", () => {
    const { getByRole, getAllByRole } = renderRail({ onCreateProject: () => {} });
    fireEvent.click(getByRole("button", { name: /Click to switch project/ }));
    const options = getAllByRole("option").map((o) => (o.textContent ?? "").trim());
    // The switcher's real job -- choosing among existing projects -- still
    // reads first; the create action is the last item, not mixed in among
    // the choices above it (it is also not its own role="option", so it is
    // never counted as a selectable project).
    expect(options).toEqual([
      "All projects",
      "Cedar Heights Villa - Phase 1",
      "✓Villa 21",
      "Marina Tower",
    ]);
  });

  test("clicking it calls onCreateProject and closes the list, without reporting a project selection", () => {
    let calls = 0;
    const { getByRole, getByText, queryByRole, chosen } = renderRail({
      onCreateProject: () => {
        calls += 1;
      },
    });
    fireEvent.click(getByRole("button", { name: /Click to switch project/ }));
    fireEvent.click(getByText("Add new project"));
    expect(calls).toBe(1);
    // Not a project choice: onSelectProject must never fire for this click.
    expect(chosen).toEqual([]);
    // Same close-then-act shape as every other choice in this list -- it
    // cannot be left open over whatever screen the click navigates to.
    expect(queryByRole("listbox")).toBeNull();
  });
});
