/// <reference types="bun-types" />
// R67 D-51. Both outcomes of the "Change project" link, including the one that
// matters most: the rail not being there.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { focusRailProjectSwitcher } from "./rail-focus";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("focusRailProjectSwitcher", () => {
  test("focuses the rail's project button when a project is selected", () => {
    document.body.innerHTML = `
      <header>
        <button aria-label="Project: Cedar Heights Villa - Phase 1. Click to switch project." id="rail">Cedar</button>
      </header>`;
    expect(focusRailProjectSwitcher()).toBe(true);
    expect(document.activeElement?.id).toBe("rail");
  });

  test("focuses it in the rail's own null state too", () => {
    document.body.innerHTML = `
      <header>
        <button aria-label="No project selected. Click to choose a project." id="rail-null">All projects</button>
      </header>`;
    expect(focusRailProjectSwitcher()).toBe(true);
    expect(document.activeElement?.id).toBe("rail-null");
  });

  test("returns false, and focuses nothing, when the rail is not on screen", () => {
    document.body.innerHTML = `<header><button aria-label="Search">Search</button></header>`;
    expect(focusRailProjectSwitcher()).toBe(false);
  });

  test("returns false rather than throwing when there is no header at all", () => {
    expect(focusRailProjectSwitcher()).toBe(false);
  });
});
