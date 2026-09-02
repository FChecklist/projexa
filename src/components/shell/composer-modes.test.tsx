/// <reference types="bun-types" />
// R67 WS-A (A-22) -- THE MODE TABS ARE GONE, AND THIS IS WHAT KEEPS THEM GONE.
//
// A-05 deleted the Projects | Customers | Vendors row from the forked
// ControlStrip, deleted the React state behind it and deleted its
// "veri.chain.mode" sessionStorage key. A-22 is the item that has to make that
// stick, so what is asserted here is not "we removed it" but the two properties
// the removal rests on:
//
//   1. THE STRIP RENDERS IDENTICALLY IN ALL THREE MODES. That is the whole
//      finding restated as a test: on PROJEXA the tabs changed nothing but
//      their own colour, so a chain's mode has no rendered consequence and a
//      control that set it could only ever look like a decision. If a future
//      change makes the mode visible again, this fails first.
//
//   2. NOTHING IMPORTS CHAIN_MODES AND NOTHING WRITES THE STORAGE KEY. The kit
//      still exports both (it is a shared dependency and other products keep
//      the row), so "we deleted it" is one import away from being untrue. The
//      source sweep is the cheapest thing that can say so.
//
// WHAT IS NOT ASSERTED HERE, and why -- see the commit body: the item's
// bounding-box acceptance ("the composer shrinks by one line") is not true of
// this fork and was never true of the kit either: the kit's mode pills sat in
// the SAME flex row as the chain (ControlStrip.tsx:49), so removing them
// recovered horizontal space, not a line.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process. Register only if no DOM is installed yet.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ControlStrip } from "./ControlStrip";
import type { ChainMode } from "@fchecklist/veridian-ui-kit/shell";

afterEach(cleanup);

const MODES: readonly ChainMode[] = ["projects", "customers", "vendors"];
const MODE_WORDS = ["Projects", "Customers", "Vendors"];

function renderStrip(mode: ChainMode) {
  return render(
    <ControlStrip
      chain={{
        mode,
        segments: [
          { id: "p1", label: "Cedar Heights", kind: "root" },
          { id: "permits", label: "Permits", kind: "action" },
        ],
      }}
      onCutFrom={() => {}}
      onHome={() => {}}
      onReset={() => {}}
      prompt="Pick an action above or type what you need on Permits"
      loaded={null}
    />
  );
}

/** The accessible name as this component can produce one: an explicit
 *  aria-label, else the button's own text. */
function accessibleName(button: HTMLElement): string {
  return (button.getAttribute("aria-label") ?? button.textContent ?? "").trim();
}

describe("no control in the strip is named for an entity mode", () => {
  for (const mode of MODES) {
    test(`mode "${mode}" renders no Projects/Customers/Vendors control`, () => {
      const { container, unmount } = renderStrip(mode);
      const names = [...container.querySelectorAll("button")].map(accessibleName);
      for (const word of MODE_WORDS) expect(names).not.toContain(word);
      unmount();
    });
  }

  test("and no tab group of any kind survives", () => {
    const { container } = renderStrip("projects");
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    // The kit's own mode row used .veri-mode-pill. The class still exists (the
    // pill band uses it), but nothing in band 1 may wear it.
    expect(container.querySelector(".veri-mode-pill")).toBeNull();
  });
});

describe("the mode has no rendered consequence at all", () => {
  test("all three modes produce byte-identical markup", () => {
    const [projects, customers, vendors] = MODES.map((mode) => {
      const { container, unmount } = renderStrip(mode);
      const html = container.innerHTML;
      unmount();
      return html;
    });
    expect(customers).toBe(projects);
    expect(vendors).toBe(projects);
  });
});

/** Every .ts/.tsx file under src, so the sweep cannot miss a new one. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

describe("the tab constant and its storage key cannot come back by accident", () => {
  const SRC = join(import.meta.dir, "..", "..");
  // This file names the forbidden constant in order to forbid it, so it is the
  // one file the sweep must skip.
  const files = sourceFiles(SRC).filter((f) => !f.endsWith("composer-modes.test.tsx"));
  // READ THE TREE ONCE. Both sweeps below used to readFileSync every .ts/.tsx
  // file in src for themselves -- two full-tree reads inside bun's default 5 s
  // per-test budget, which is fine on a quiet machine (4.9 s for the file) and
  // times out on a loaded CI runner (measured: 81.8 s for one of them while the
  // linter was running). One read, shared, plus an explicit budget, so a slow
  // runner reports a real failure instead of a timeout.
  const sources: readonly (readonly [string, string])[] = files.map((f) => [f, readFileSync(f, "utf8")] as const);
  const SWEEP_TIMEOUT_MS = 30_000;

  test("the sweep is actually reading this repo", () => {
    // A silent zero would make every assertion below vacuously true.
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.some(([f]) => f.endsWith("M24Shell.tsx"))).toBe(true);
  });

  test(
    "nothing imports or mentions CHAIN_MODES",
    () => {
      // The kit still EXPORTS it -- other products keep the row -- so this is
      // one import away from being untrue at any time.
      const offenders = sources.filter(([, text]) => text.includes("CHAIN_MODES")).map(([f]) => f);
      expect(offenders).toEqual([]);
    },
    SWEEP_TIMEOUT_MS
  );

  test(
    "nothing reads or writes the 'veri.chain.mode' storage key",
    () => {
      // Matched as a STORAGE CALL, not as a string: the deleted key is named in
      // two comments that explain why it is gone, and a test that forbade the
      // words would forbid the explanation.
      const storageCall = /(?:get|set|remove)Item\s*\(\s*[^)]*veri\.chain\.mode/;
      const offenders = sources.filter(([, text]) => storageCall.test(text)).map(([f]) => f);
      expect(offenders).toEqual([]);
    },
    SWEEP_TIMEOUT_MS
  );
});
