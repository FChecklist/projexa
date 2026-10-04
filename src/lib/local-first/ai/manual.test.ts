// The manual in all its static forms: /ai-manual.json, /llms.txt and the in-page script tag. Static, no personal data,
// every write function with its role, and the explicit statement that the software cannot be changed.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GET as manualJsonRoute, dynamic as jsonDynamic } from "@/app/ai-manual.json/route";
import { GET as llmsRoute, dynamic as llmsDynamic } from "@/app/llms.txt/route";
import { requiresAuthenticatedPage } from "@/lib/authz/page-access";
import { inlineManualJson } from "./AiAttach";
import { SOFTWARE_STATEMENT, buildManual, manualText } from "./manual";
import { WRITE_FUNCTIONS, actionOf } from "./registry";
import { TOOLS } from "./tools";

describe("the static manual", () => {
  test("lists every usable write with its lowest role, and every tool", () => {
    const m = buildManual();
    const listed = (["create", "update", "delete"] as const).flatMap((a) => m.writes.functions[a].map((f) => [f.id, a, f.min_role_rank]));
    // lf-e11: every usable write EXCEPT create_project, which this surface always refuses (made online): the manual must not offer it
    expect(listed.sort()).toEqual(WRITE_FUNCTIONS.filter((f) => f.function_id !== "create_project").map((f) => [f.function_id, actionOf(f.function_id), f.min_role_rank]).sort());
    expect(listed.map(([id]) => id)).not.toContain("create_project");
    expect(m.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(m.for_role).toBeNull();
  });

  test("says the software cannot be changed, in the JSON and in plain words", () => {
    const m = buildManual();
    expect(m.software_can_be_changed).toBe(false);
    expect(m.software_statement).toBe(SOFTWARE_STATEMENT);
    expect(SOFTWARE_STATEMENT).toContain("No AI can change PROJEXA's software");
    const text = manualText(m);
    expect(text.startsWith("# PROJEXA\n")).toBe(true);
    expect(text).toContain(SOFTWARE_STATEMENT);
    expect(text).toContain("- create_rfi -- ");
    expect(text).toContain("confirms with one click");
  });

  test("/ai-manual.json and /llms.txt are force-static, public, and carry no personal data", async () => {
    expect(jsonDynamic).toBe("force-static");
    expect(llmsDynamic).toBe("force-static");
    const json = manualJsonRoute();
    expect(json.headers.get("Content-Type")).toContain("application/json");
    expect(await json.json()).toEqual(JSON.parse(JSON.stringify(buildManual())));
    const txt = llmsRoute();
    expect(txt.headers.get("Content-Type")).toContain("text/plain");
    expect(await txt.text()).toBe(manualText(buildManual()));
    expect(requiresAuthenticatedPage("/ai-manual.json")).toBe(false);
    expect(requiresAuthenticatedPage("/llms.txt")).toBe(false);
    // The routes read nothing but the manual builder (no cookies, no headers, no database, no env).
    for (const f of ["ai-manual.json", "llms.txt"]) {
      const src = readFileSync(join(import.meta.dir, "../../../app", f, "route.ts"), "utf8");
      expect(src).not.toMatch(/cookies|headers\(|process\.env|supabase|@\/lib\/db/);
    }
  });

  test("the in-page manual is the same JSON, and no value can close its script tag", () => {
    const inline = inlineManualJson();
    expect(inline).not.toContain("<");
    expect(JSON.parse(inline)).toEqual(JSON.parse(JSON.stringify(buildManual())));
  });
});
