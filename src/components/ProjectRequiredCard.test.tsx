/// <reference types="bun-types" />
// R67 D-66 -- what a per-project module says under "All projects".
//
// The alternative, which is what the product did, was to resolve projects[0]
// silently and render that project's rows under a rail that said "All
// projects". D-20 stopped the guess; this is the sentence that replaces it,
// and these assertions pin the two things that make it a control rather than
// an apology: the projects are listed inside the card, and the module's own
// "+ New" stays visible with its reason instead of disappearing.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/materials",
}));

const { ProjectRequiredCard } = await import("./ProjectRequiredCard");
const { ProjectScopeProvider } = await import("./shell/project-context");

afterEach(cleanup);

const CEDAR = { id: "p-cedar", name: "Cedar Heights Villa - Phase 1" };
const VILLA = { id: "p-villa", name: "Villa 21" };

function renderCard(
  overrides: Partial<Parameters<typeof ProjectScopeProvider>[0]["value"]> = {}
) {
  return render(
    <ProjectScopeProvider
      value={{
        projects: [CEDAR, VILLA],
        project: null,
        projectId: null,
        projectsLoaded: true,
        selectProject: () => {},
        openSwitcher: () => {},
        ...overrides,
      }}
    >
      <ProjectRequiredCard module="Materials" />
    </ProjectScopeProvider>
  );
}

describe("ProjectRequiredCard", () => {
  test("says the exact sentence R-253 specifies", () => {
    const { container } = renderCard();
    expect(container.textContent).toContain("Materials are kept per project — pick a project to continue");
  });

  test("the projects are listed inside the card, not only behind the switcher", () => {
    const { getByRole } = renderCard();
    expect(getByRole("button", { name: "Cedar Heights Villa - Phase 1" })).toBeTruthy();
    expect(getByRole("button", { name: "Villa 21" })).toBeTruthy();
  });

  test("choosing one from the card switches project", () => {
    let chosen: string | null = null;
    const { getByRole } = renderCard({ selectProject: (p) => { chosen = p?.id ?? null; } });
    fireEvent.click(getByRole("button", { name: "Villa 21" }));
    expect(chosen).toBe("p-villa");
  });

  test("'+ New' stays visible and disabled with its reason -- never hidden", () => {
    const { getByRole, container } = renderCard();
    expect((getByRole("button", { name: "+ New" }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("Pick a project first");
  });

  test("'no projects yet' and 'still loading' are different sentences", () => {
    const loaded = renderCard({ projects: [], projectsLoaded: true });
    expect(loaded.container.textContent).toContain("No projects to choose from yet.");
    cleanup();
    const loading = renderCard({ projects: [], projectsLoaded: false });
    expect(loading.container.textContent).toContain("Still loading the project list…");
    expect(loading.container.textContent).not.toContain("No projects to choose from yet.");
  });
});
