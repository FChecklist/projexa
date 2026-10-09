/// <reference types="bun-types" />
// Traditional View | Modern View. A person clicks the switch in the top rail;
// the choice must persist (re-read from storage, not just a changed label),
// default to Modern, and in Traditional the left pane must hold the module
// menu above the chat card.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import ViewModeToggle from "./ViewModeToggle";
import { AppShell } from "./AppShell";
import { TopRail } from "./TopRail";
import { VIEW_MODE_KEY, parseViewMode, readViewMode, useViewMode } from "@/lib/view-mode";

// `screen` binds document.body at import time, before the DOM is registered here; query at call time instead.
const screen = {
  getByRole: (...a: Parameters<ReturnType<typeof within>["getByRole"]>) => within(document.body).getByRole(...a),
  getByTestId: (id: string) => within(document.body).getByTestId(id),
  queryByTestId: (id: string) => within(document.body).queryByTestId(id),
};

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function Harness() {
  const [mode] = useViewMode();
  return (
    <AppShell
      topRail={<TopRail brand={<span>PROJEXA</span>} viewToggle={<ViewModeToggle />} />}
      taskMaster={<div>tasks</div>}
      composer={<div>chat box</div>}
      traditionalMenu={mode === "traditional" ? <div>module menu</div> : undefined}
    >
      <div>screen</div>
    </AppShell>
  );
}

describe("view mode store", () => {
  test("Traditional is the default; only a stored 'modern' gives Modern", () => {
    expect(parseViewMode(null)).toBe("traditional");
    expect(parseViewMode("")).toBe("traditional");
    expect(parseViewMode("garbage")).toBe("traditional");
    expect(parseViewMode("traditional")).toBe("traditional");
    expect(parseViewMode("modern")).toBe("modern");
  });
});

describe("Traditional View | Modern View switch", () => {
  test("both options are offered, Traditional is the default and is marked", () => {
    render(<ViewModeToggle />);
    expect(screen.getByRole("button", { name: "Traditional View" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Modern View" }).getAttribute("aria-pressed")).toBe("false");
  });

  test("clicking Modern persists it and re-reading storage returns it; Traditional returns", () => {
    render(<ViewModeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Modern View" }));
    expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBe("modern");
    expect(readViewMode()).toBe("modern");
    expect(screen.getByRole("button", { name: "Modern View" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Traditional View" }));
    expect(readViewMode()).toBe("traditional");
  });

  test("a person who chose Modern last time gets Modern on the next visit", () => {
    window.localStorage.setItem(VIEW_MODE_KEY, "modern");
    render(<Harness />);
    expect(screen.queryByTestId("traditional-menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Modern View" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("by default the left pane has the menu above the chat card; Modern removes the menu", () => {
    render(<Harness />);
    const menu = screen.getByTestId("traditional-menu");
    expect(menu.textContent).toContain("module menu");
    const aside = menu.parentElement as HTMLElement;
    const children = Array.from(aside.children);
    expect(children[0]).toBe(menu);
    expect(children[1].textContent).toContain("chat box");
    expect(menu.style.flex.startsWith("2")).toBe(true);
    expect((children[1] as HTMLElement).style.flex.startsWith("1")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Modern View" }));
    expect(screen.queryByTestId("traditional-menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Traditional View" }));
    expect(screen.getByTestId("traditional-menu")).toBeTruthy();
  });

  test("the switch sits in the top rail's right-hand group", () => {
    render(<Harness />);
    const header = screen.getByRole("banner");
    const group = screen.getByRole("group", { name: "View" });
    expect(header.contains(group)).toBe(true);
    expect((group.parentElement as HTMLElement).className).toContain("ml-auto");
  });
});
