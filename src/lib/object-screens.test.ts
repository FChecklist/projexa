/// <reference types="bun-types" />
// R67 WS-A (A-21). The assertable half of "on object pages the strip root names
// the object". The other half -- four Playwright page loads -- needs a dev
// server this lane may not start, so what is pinned here is everything the
// browser would be checking the OUTPUT of: the four kind words the acceptance
// names, the segment they compose into, and the cases where there is honestly
// no object segment to render at all.

import { describe, expect, test } from "bun:test";
import {
  OBJECT_KIND_BY_MODULE,
  catalogueModuleIds,
  objectKindFor,
  objectKindModuleIds,
  objectPromptLabel,
  objectSegmentFor,
  railDestinationForObject,
} from "./object-screens";

describe("the kind word is one word, in one place", () => {
  test("A-21's own four: BOQ, Meeting, Worker, Material", () => {
    expect(objectKindFor({ moduleId: "scope" })).toBe("BOQ");
    expect(objectKindFor({ moduleId: "moms" })).toBe("Meeting");
    expect(objectKindFor({ moduleId: "labour" })).toBe("Worker");
    expect(objectKindFor({ moduleId: "materials" })).toBe("Material");
  });

  test("and the three other object pages this item wires", () => {
    expect(objectKindFor({ moduleId: "permits" })).toBe("Permit");
    expect(objectKindFor({ moduleId: "drawings" })).toBe("Drawing");
    expect(objectKindFor({ moduleId: "schedule" })).toBe("Task");
  });

  test("every module named here is a real module -- a typo cannot ship", () => {
    const modules = catalogueModuleIds();
    for (const id of objectKindModuleIds()) expect(modules).toContain(id);
  });

  test("a module with no object page has no kind word, and that is not a failure", () => {
    // The Dashboard and Reports have no record you can stand on. They must fall
    // back to A-06's module segment rather than invent one.
    expect(objectKindFor({ moduleId: "dashboard" })).toBeNull();
    expect(objectKindFor({ moduleId: "reports" })).toBeNull();
  });

  test("a page may name its own kind when its records are not the module's own", () => {
    expect(objectKindFor({ moduleId: "materials", kind: "Receipt" })).toBe("Receipt");
    // Whitespace is not a word: it falls through to the table rather than
    // rendering a kind of " ".
    expect(objectKindFor({ moduleId: "materials", kind: "   " })).toBe("Material");
  });
});

describe("the second fixed segment", () => {
  test("reads '<kind> <label>' -- the acceptance's own example", () => {
    expect(objectSegmentFor({ moduleId: "scope", label: "R66 Audit BOQ 1009b", projectId: "p1" })?.label).toBe(
      "BOQ R66 Audit BOQ 1009b"
    );
  });

  test("the four prefixes the acceptance looks for", () => {
    const prefix = (moduleId: string, label: string) =>
      objectSegmentFor({ moduleId, label, projectId: "p1" })!.label;
    expect(prefix("scope", "R66 Audit BOQ 1009b").startsWith("BOQ ")).toBe(true);
    expect(prefix("moms", "R66 Audit Meeting 0930").startsWith("Meeting ")).toBe(true);
    expect(prefix("labour", "Ramesh Kumar").startsWith("Worker ")).toBe(true);
    expect(prefix("materials", "OPC 43-grade cement").startsWith("Material ")).toBe(true);
  });

  test("its id cannot be confused with the module segment it replaces", () => {
    // M24Shell derives the PICKED module from the first "action" segment and
    // builds the screen's own module segment as "screen:<id>". An object segment
    // sharing either shape would make the shell believe the user had chosen
    // something. It is its own namespace.
    const segment = objectSegmentFor({ moduleId: "scope", label: "Villa Tower BOQ", projectId: "p1" })!;
    expect(segment.id).toBe("object:scope");
    expect(segment.id).not.toBe("screen:scope");
    expect(segment.id).not.toBe("scope");
  });

  test("nothing published yet is null, not an empty segment", () => {
    expect(objectSegmentFor(null)).toBeNull();
  });

  test("a record with no label yet is null -- '<project> › BOQ' names nothing", () => {
    expect(objectSegmentFor({ moduleId: "scope", label: "", projectId: "p1" })).toBeNull();
    expect(objectSegmentFor({ moduleId: "scope", label: "   ", projectId: "p1" })).toBeNull();
  });

  test("a module with no kind word is null -- the module segment stands", () => {
    expect(objectSegmentFor({ moduleId: "budgets", label: "FY26 site overheads", projectId: "p1" })).toBeNull();
  });

  test("a record with no project still names itself", () => {
    // A meeting can be filed against no project at all. The strip then reads
    // "Meeting <title>" with no root, which is the truth about that record.
    expect(objectSegmentFor({ moduleId: "moms", label: "Board review", projectId: null })?.label).toBe(
      "Meeting Board review"
    );
  });
});

describe("the composer's next question names the same thing the strip does", () => {
  test("'this BOQ', not 'Scope of Work'", () => {
    expect(objectPromptLabel({ moduleId: "scope", label: "Villa Tower BOQ", projectId: "p1" })).toBe("this BOQ");
    expect(objectPromptLabel({ moduleId: "labour", label: "Ramesh Kumar", projectId: "p1" })).toBe("this Worker");
  });

  test("the record's own label is deliberately NOT repeated in the sentence", () => {
    // It is already on screen twice -- the strip and the page heading -- and a
    // third copy inside "Pick an action above or type what you need on ..."
    // makes that sentence unreadable on a phone.
    const label = objectPromptLabel({ moduleId: "scope", label: "R66 Audit BOQ 1009b", projectId: "p1" })!;
    expect(label.includes("R66 Audit BOQ 1009b")).toBe(false);
  });

  test("no object, or no kind word, means no override", () => {
    expect(objectPromptLabel(null)).toBeNull();
    expect(objectPromptLabel({ moduleId: "budgets", label: "FY26", projectId: "p1" })).toBeNull();
  });
});

describe("the top rail's switch is not left inert by this item", () => {
  const boq = { moduleId: "scope", label: "R66 Audit BOQ 1009b", projectId: "p1" };

  test("it goes to the same module in the project just chosen", () => {
    expect(railDestinationForObject(boq, "p2")).toBe("/scope?projectId=p2");
  });

  test("'All projects' goes to the module's own list, unscoped", () => {
    expect(railDestinationForObject(boq, null)).toBe("/scope");
  });

  test("an org-wide module carries no project into the URL", () => {
    // Customers has needsProject: false, so a ?projectId= there would mean
    // nothing on the screen it opens.
    expect(railDestinationForObject({ moduleId: "customers", label: "Acme", projectId: null }, "p2")).toBe(
      "/customers"
    );
  });

  test("no record, or a module with no route, falls back rather than inventing one", () => {
    expect(railDestinationForObject(null, "p2")).toBeNull();
    expect(railDestinationForObject({ moduleId: "not-a-module", label: "x", projectId: null }, "p2")).toBeNull();
  });
});

describe("the table itself", () => {
  test("is a plain record of single words, so a kind can never carry markup", () => {
    for (const [moduleId, word] of Object.entries(OBJECT_KIND_BY_MODULE)) {
      expect(typeof word).toBe("string");
      expect(word.trim()).toBe(word);
      expect(word.length).toBeGreaterThan(0);
      expect(moduleId.trim()).toBe(moduleId);
    }
  });
});
