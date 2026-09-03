import { describe, expect, test } from "bun:test";
import {
  answersNeededLabel,
  echoClause,
  echoFields,
  echoLine,
  looksLikeCreate,
  rankOptions,
  refusalFor,
  scoreOption,
  showAllLabel,
} from "./gap-card";

describe("the echo names every value that was read", () => {
  test("C-12's own sentence, field by field", () => {
    const fields = echoFields({
      projectId: "p1",
      project: "Cedar Heights Villa - Phase 1",
      activityType: "excavation",
      percent: 50,
      spentOn: "02-09-2026",
    });
    expect(echoLine("Record Work Progress › New entry", fields)).toBe(
      "Understood: Record Work Progress › New entry — Project: Cedar Heights Villa - Phase 1 · Category: excavation · 50 % · Date: 02-09-2026"
    );
  });

  test("an id the user never typed is never echoed back at them", () => {
    const fields = echoFields({ projectId: "cm3x8k2p90001", itemCode: "R60SK-A" });
    expect(fields.map((f) => f.name)).toEqual(["itemCode"]);
  });

  test("a percentage carries its unit instead of a label", () => {
    expect(echoClause({ name: "percent", label: "Percent complete", value: "50" })).toBe("50 %");
    expect(echoClause({ name: "hours", label: "Hours", value: "3" })).toBe("Hours: 3");
  });

  test("no camelCase parameter name survives into the sentence", () => {
    const fields = echoFields({ itemCode: "R60SK-A", quantityDone: 2 });
    const line = echoLine("Record Work Progress › New entry", fields);
    expect(line).not.toContain("itemCode");
    expect(line).not.toContain("quantityDone");
    expect(line).toContain("BOQ line: R60SK-A");
  });

  test("empty and blank values are dropped, not printed as holes", () => {
    expect(echoFields({ itemCode: "", percent: null, hours: undefined, task: "  " })).toEqual([]);
  });

  test("with nothing resolved the line stops after the title", () => {
    expect(echoLine("Record Work Progress › New entry", [])).toBe("Understood: Record Work Progress › New entry");
  });
});

describe("one question, and it says how many answers it is waiting for", () => {
  test("the label counts, and is singular for one", () => {
    expect(answersNeededLabel(1)).toBe("1 answer needed");
    expect(answersNeededLabel(2)).toBe("2 answers needed");
  });

  test("nothing missing means no label at all, not '0 answers needed'", () => {
    expect(answersNeededLabel(0)).toBeNull();
    expect(answersNeededLabel(-1)).toBeNull();
  });

  test("the expander names the count and the noun of the thing", () => {
    expect(showAllLabel(28, "lines")).toBe("Show all 28 lines");
    expect(showAllLabel(3)).toBe("Show all 3 options");
  });
});

describe("the two best matches come first", () => {
  const options = [
    { id: "a", label: "R60SK-A Excavation and earth works" },
    { id: "b", label: "R60SK-B Blockwork" },
    { id: "c", label: "R60SK-C Excavation to reduced level" },
    { id: "d", label: "R60SK-D Plaster", keywords: "finishes" },
  ];

  test("an exact label beats a partial one", () => {
    expect(scoreOption({ id: "x", label: "Blockwork" }, "blockwork")).toBeGreaterThan(
      scoreOption({ id: "y", label: "R60SK-B Blockwork" }, "blockwork")
    );
  });

  test("the typed word promotes exactly the lines that contain it", () => {
    const { best, rest } = rankOptions(options, "excavation");
    expect(best.map((o) => o.id)).toEqual(["a", "c"]);
    expect(rest.map((o) => o.id)).toEqual(["b", "d"]);
  });

  test("keywords are searched too, so a trade finds its line", () => {
    const { best } = rankOptions(options, "finishes");
    expect(best.map((o) => o.id)).toEqual(["d"]);
  });

  test("nothing matching promotes NOTHING -- a wrong first chip is worse than one chip", () => {
    const { best, rest } = rankOptions(options, "scaffolding");
    expect(best).toEqual([]);
    expect(rest.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("no query at all leaves the server's own order untouched", () => {
    const { best, rest } = rankOptions(options, "   ");
    expect(best).toEqual([]);
    expect(rest.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("best and rest together are always the whole list, with nothing lost or repeated", () => {
    const { best, rest } = rankOptions(options, "excavation");
    expect([...best, ...rest].map((o) => o.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("a tie keeps the server's order -- the order of the bill", () => {
    const ties = [
      { id: "1", label: "Excavation north" },
      { id: "2", label: "Excavation south" },
    ];
    expect(rankOptions(ties, "excavation").best.map((o) => o.id)).toEqual(["1", "2"]);
  });
});

describe("the refusal names the screen that CAN do it", () => {
  test("nothing is refused when the pipeline can actually run it", () => {
    expect(refusalFor({ mode: "projects", verdict: "task", executable: true })).toBeNull();
  });

  test("a create in Customers mode points at the form this product really has", () => {
    const r = refusalFor({ mode: "customers", verdict: "task", executable: false, creating: true });
    expect(r?.sentence).toBe("Customers can't be created from the composer yet — open the Customers form →");
    expect(r?.href).toBe("/customers/new");
  });

  test("a question the workspace cannot answer still ends on a screen", () => {
    const r = refusalFor({
      mode: "projects",
      verdict: "chat",
      executable: false,
      nearestScreen: { label: "Budget", route: "/budgets" },
    });
    expect(r?.sentence).toBe("Questions aren't switched on for this workspace yet — here is the Budget screen →");
    expect(r?.href).toBe("/budgets");
  });

  test("with no nearby screen the sentence stops honestly rather than inventing a link", () => {
    const r = refusalFor({ mode: "projects", verdict: "chat", executable: false });
    expect(r?.sentence).toBe("Questions aren't switched on for this workspace yet.");
    expect(r?.href).toBeNull();
    expect(r?.linkLabel).toBeNull();
  });

  test("a gap the pipeline cannot run is pointed at the nearest screen", () => {
    const r = refusalFor({
      mode: "projects",
      verdict: "gap",
      executable: false,
      nearestScreen: { label: "Permits", route: "/permits" },
    });
    expect(r?.sentence).toBe("PROJEXA can't do that from here yet — here is the Permits screen →");
  });

  test("no refusal sentence carries a function id or a parameter name", () => {
    const sentences = [
      refusalFor({ mode: "customers", verdict: "task", executable: false, creating: true })?.sentence,
      refusalFor({ mode: "projects", verdict: "chat", executable: false })?.sentence,
      refusalFor({ mode: "projects", verdict: "gap", executable: false })?.sentence,
    ];
    for (const s of sentences) {
      expect(s).not.toMatch(/_/);
      expect(s).not.toMatch(/[a-z][A-Z]/);
    }
  });

  test("the create verbs are a closed list, not a guess", () => {
    expect(looksLikeCreate("create a customer called Acme")).toBe(true);
    expect(looksLikeCreate("add a new vendor")).toBe(true);
    expect(looksLikeCreate("how many customers do we have")).toBe(false);
  });
});
