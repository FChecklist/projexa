/// <reference types="bun-types" />
// R67 WS-A (A-21) -- "ControlStrip with rootSegments renders them without
// remove controls", which is A-21's own named unit test, run here against
// PROJEXA's fork (D-09: there is no kit to add a test to, and the fork is what
// actually renders).
//
// The Playwright half of the acceptance -- open /scope/<id>, /moms/<id>,
// /labour/<id>, /materials/<id> and read the strip -- needs a dev server this
// lane may not start, so it has NOT been run and is not claimed. What is
// asserted here is everything that half would be reading: the two fixed
// segments in order, that neither offers a Remove, that the third segment
// still does, and that the retired "Select a module to begin" cannot appear.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process. Register only if no DOM is installed yet.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ControlStrip } from "./ControlStrip";
import { objectSegmentFor } from "@/lib/object-screens";

afterEach(cleanup);

/** The chain M24Shell builds on an object page: project, record, then whatever
 *  the user has said. Built through objectSegmentFor() rather than by hand, so
 *  this test breaks if the two ever disagree about the words. */
function objectChain(
  moduleId: string,
  label: string,
  projectName = "Cedar Heights",
  userSegments: { id: string; label: string; kind: "action" | "step" }[] = []
) {
  const object = objectSegmentFor({ moduleId, label, projectId: "p1" })!;
  return {
    mode: "projects" as const,
    segments: [
      { id: "p1", label: projectName, kind: "root" as const },
      { id: object.id, label: object.label, kind: "root" as const },
      ...userSegments,
    ],
  };
}

function renderStrip(chain: ReturnType<typeof objectChain>, prompt = "") {
  return render(
    <ControlStrip
      chain={chain}
      onCutFrom={() => {}}
      onHome={() => {}}
      onReset={() => {}}
      prompt={prompt}
      loaded={null}
    />
  );
}

describe("the first two segments are fixed", () => {
  test("the strip reads '<project> › BOQ <label>' before anything is clicked", () => {
    const { container } = renderStrip(objectChain("scope", "R66 Audit BOQ 1009b"));
    const segments = [...container.querySelectorAll("button")]
      .filter((b) => b.getAttribute("title") && !b.getAttribute("aria-label"))
      .map((b) => b.getAttribute("title"));
    expect(segments.slice(0, 2)).toEqual(["Cedar Heights", "BOQ R66 Audit BOQ 1009b"]);
  });

  test("neither of them offers a Remove -- you are standing in both", () => {
    const { queryAllByText } = renderStrip(objectChain("scope", "R66 Audit BOQ 1009b"));
    expect(queryAllByText("Remove").length).toBe(0);
  });

  test("a segment the USER added still offers one, and only that one", () => {
    const { getAllByText } = renderStrip(
      objectChain("scope", "R66 Audit BOQ 1009b", "Cedar Heights", [
        { id: "scope.revise", label: "Create revision", kind: "step" },
      ])
    );
    const removes = getAllByText("Remove").map((el) => el.closest("button")!);
    expect(removes.length).toBe(1);
    expect(removes[0].getAttribute("aria-label")).toBe("Remove Create revision and everything after it");
  });

  test("the object segment is the SECOND word, not a third one after the module", () => {
    // "<project> › Scope of Work › BOQ 1009b" would name the module twice --
    // "BOQ" is this product's own word for a Scope of Work record. The strip
    // must be exactly two fixed segments.
    const { container } = renderStrip(objectChain("scope", "R66 Audit BOQ 1009b"));
    expect(container.textContent).not.toContain("Scope of Work");
  });

  test("the other three object kinds render the words the acceptance reads", () => {
    for (const [moduleId, label, expected] of [
      ["moms", "R66 Audit Meeting 0930", "Meeting R66 Audit Meeting 0930"],
      ["labour", "Ramesh Kumar", "Worker Ramesh Kumar"],
      ["materials", "OPC 43-grade cement", "Material OPC 43-grade cement"],
    ] as const) {
      const { container, unmount } = renderStrip(objectChain(moduleId, label));
      const titles = [...container.querySelectorAll("button")].map((b) => b.getAttribute("title"));
      expect(titles).toContain(expected);
      unmount();
    }
  });
});

describe("what the strip must never say on an object page", () => {
  test("'Select a module to begin' is not in this component at all", () => {
    const { container } = renderStrip(objectChain("moms", "R66 Audit Meeting 0930"));
    expect(container.textContent).not.toContain("Select a module to begin");
  });

  test("a long project name folds at a word and keeps the full name in its title", () => {
    // A-06's rule, re-asserted here because the acceptance reads the strip TEXT
    // for a project whose real name is longer than the fold: the visible text
    // is folded, and the unfolded name is still available to a person hovering
    // and to a screen reader.
    const { container } = renderStrip(objectChain("scope", "1009b", "Cedar Heights Villa - Phase 1"));
    const first = container.querySelector("button")!;
    expect(first.getAttribute("title")).toBe("Cedar Heights Villa - Phase 1");
    expect(first.textContent!.endsWith("…")).toBe(true);
  });
});
