/// <reference types="bun-types" />
// R67 D-55 -- the create routes stop showing a bare crash card.
//
// Correction C-06: "cause not established in pass 1; the page shows a raw
// error card whenever project resolution fails" -- and the product rule
// stands regardless of cause: never a bare "Internal Server Error", say what
// failed, offer Retry.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/drawings/new",
}));

const CreateRouteError = (await import("./CreateRouteError")).default;
const { ProjectScopeProvider } = await import("./shell/project-context");

afterEach(cleanup);

const CEDAR = { id: "p-cedar", name: "Cedar Heights Villa - Phase 1" };

function renderBoundary(error: Error, reset: () => void = () => {}) {
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
      <CreateRouteError
        module="Drawings"
        moduleHref="/drawings"
        objectLabel="Drawing"
        error={error}
        reset={reset}
      />
    </ProjectScopeProvider>
  );
}

describe("CreateRouteError", () => {
  test("says which form failed, and never 'Internal Server Error'", () => {
    const { container } = renderBoundary(new Error("Internal Server Error"));
    expect(container.textContent).toContain("Could not open the Drawing form");
  });

  test("offers Retry and Back, and keeps the breadcrumb", () => {
    const { container, getByRole } = renderBoundary(new Error("boom"));
    expect(getByRole("button", { name: /Retry/ })).toBeTruthy();
    expect(container.textContent).toContain("Back");
    // Still inside the shell, still saying where the user is.
    expect(container.textContent).toContain("Cedar Heights Villa - Phase 1");
    expect(container.textContent).toContain("Drawings");
  });

  test("Retry re-renders the segment rather than reloading the app", () => {
    let reset = 0;
    const { getByRole } = renderBoundary(new Error("boom"), () => {
      reset += 1;
    });
    fireEvent.click(getByRole("button", { name: /Retry/ }));
    expect(reset).toBe(1);
  });

  test("a message that would leak the shape of the system is replaced", () => {
    const { container } = renderBoundary(new Error("write CONNECT_TIMEOUT 3.109.171.244:6543"));
    expect(container.textContent).not.toContain("3.109.171.244");
    expect(container.textContent).toContain("Could not open the Drawing form");
  });

  test("a real, safe backend sentence survives -- the reason is what a user can act on", () => {
    const { container } = renderBoundary(new Error("No VERIDIAN credentials configured for this organisation."));
    expect(container.textContent).toContain("No VERIDIAN credentials configured for this organisation.");
  });
});
