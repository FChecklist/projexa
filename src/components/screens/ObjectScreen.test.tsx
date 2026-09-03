/// <reference types="bun-types" />
// R67 D-67 -- the object archetype, rendered.
//
// R-257's four rules, asserted: display first, Delete separated from Edit,
// an inline confirmation that names the blast radius (not "are you sure",
// and not a modal -- D-01 removed PROJEXA's last popup and this is not the
// place to add one), and a footer receipt that persists rather than fading.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/permits/x",
}));

const { ObjectScreen } = await import("./ObjectScreen");
const { ProjectScopeProvider } = await import("../shell/project-context");
const { deleteConfirmation } = await import("@/lib/create-screen");

afterEach(cleanup);

const CEDAR = { id: "p-cedar", name: "Cedar Heights Villa - Phase 1" };

function renderScreen(props: Partial<Parameters<typeof ObjectScreen>[0]> = {}) {
  return render(
    <ProjectScopeProvider
      value={{
        projects: [CEDAR],
        project: CEDAR,
        projectId: CEDAR.id,
        projectsLoaded: true,
        selectProject: () => {},
        openSwitcher: () => {},
      }}
    >
      <ObjectScreen
        module="Permits"
        moduleHref="/permits"
        objectLabel="Permit"
        title="BP-2026-0142"
        facets={[{ label: "Project", value: CEDAR.name }]}
        {...props}
      >
        <p>Issued 12 Jan 2026</p>
      </ObjectScreen>
    </ProjectScopeProvider>
  );
}

describe("ObjectScreen", () => {
  test("opens in display mode -- the record, not a form", () => {
    const { container, queryByRole } = renderScreen();
    expect(container.textContent).toContain("BP-2026-0142");
    expect(container.textContent).toContain("Issued 12 Jan 2026");
    expect(queryByRole("textbox")).toBeNull();
  });

  test("the facet states which project the record belongs to", () => {
    const { container } = renderScreen();
    expect(container.textContent).toContain("Project");
    expect(container.textContent).toContain("Cedar Heights Villa - Phase 1");
  });

  test("Delete does not fire on its own click -- it asks first, naming what goes", () => {
    let deleted = 0;
    const { getByRole, container } = renderScreen({
      onEdit: () => {},
      onDelete: {
        confirmation: deleteConfirmation("Permit", "BP-2026-0142", "and its PDF"),
        run: () => {
          deleted += 1;
        },
      },
    });

    fireEvent.click(getByRole("button", { name: "Delete" }));
    expect(deleted).toBe(0);
    expect(container.textContent).toContain("Delete permit BP-2026-0142 and its PDF? This cannot be undone.");
    // Not a modal: the record is still on screen behind the question.
    expect(container.textContent).toContain("Issued 12 Jan 2026");
  });

  test("confirming actually deletes; cancelling does not", async () => {
    let deleted = 0;
    const { getByRole } = renderScreen({
      onDelete: { confirmation: "Delete permit BP-2026-0142? This cannot be undone.", run: () => { deleted += 1; } },
    });

    fireEvent.click(getByRole("button", { name: "Delete" }));
    fireEvent.click(getByRole("button", { name: "Cancel" }));
    expect(deleted).toBe(0);

    fireEvent.click(getByRole("button", { name: "Delete" }));
    // The confirm handler awaits run(), so the state settles a microtask
    // later -- act() is what lets React flush that before the assertion.
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Delete permit" }));
    });
    expect(deleted).toBe(1);
  });

  test("a module with no delete path renders no Delete control at all -- never a dead one", () => {
    const { queryByRole } = renderScreen({ onEdit: () => {} });
    expect(queryByRole("button", { name: "Delete" })).toBeNull();
  });

  test("a delete that is blocked says why, beside the disabled control", () => {
    const { getByRole, container } = renderScreen({
      onDelete: { confirmation: "…", run: () => {}, disabledReason: "This permit is referenced by a work order" },
    });
    expect((getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("This permit is referenced by a work order");
  });

  test("the footer receipt is a persistent status line, not a toast", () => {
    const { getByRole } = renderScreen({ footerMessage: "Created permit BP-2026-0142" });
    expect(getByRole("status").textContent).toBe("Created permit BP-2026-0142");
  });

  test("the autosave slot renders where a screen has one", () => {
    const { container } = renderScreen({ autosave: "Saved 12:04" });
    expect(container.textContent).toContain("Saved 12:04");
  });
});
