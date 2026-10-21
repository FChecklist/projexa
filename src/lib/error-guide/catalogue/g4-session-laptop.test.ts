/// <reference types="bun-types" />
// GROUP G4 guides: every code the G4 screens raise must land on a G4 guide (never the generic fallback), and every guide must obey the contract.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchGuide, resolveGuide } from "../match";
import { g4Guides } from "./g4-session-laptop";

const SRC = join(import.meta.dir, "..", "..", "..");
const SOURCES = [
  "app/login/page.tsx", "lib/auth/email-code-login.ts", "components/SessionGuard.tsx", "components/OrgEnsure.tsx", "components/OutboxAttention.tsx",
  "components/local-first/ShellStateNote.tsx", "lib/browser-check.ts", "components/BrowserNotice.tsx", "components/NotFoundGuide.tsx", "components/CopilotClient.tsx",
  "components/veri-chat/VeriComposer.tsx", "lib/org/invite-failure.ts", "app/invite/[token]/page.tsx",
];

describe("G4 guides", () => {
  test("ids unique, titles <= 8 words, 1-4 steps, every guide names a match key", () => {
    const ids = new Set<string>();
    for (const g of g4Guides) {
      expect(ids.has(g.id)).toBe(false);
      ids.add(g.id);
      expect(g.title.split(/\s+/).length).toBeLessThanOrEqual(8);
      expect(g.steps.length).toBeGreaterThanOrEqual(1);
      expect(g.steps.length).toBeLessThanOrEqual(4);
      expect(Object.keys(g.match).length).toBeGreaterThan(0);
    }
  });

  test("every code literal used by the G4 screens resolves to a G4 guide", () => {
    const codes = new Set<string>();
    for (const f of SOURCES) {
      const text = readFileSync(join(SRC, f), "utf8");
      for (const m of text.matchAll(/["']((?:LOGIN|SESSION|ORG|OUTBOX|LAPTOP|BROWSER|INVITE|AI|PAGE|SYSTEM|STORAGE|INDEXEDDB|INSTALL|SW)_[A-Z_]+)["']/g)) codes.add(m[1]!);
    }
    codes.delete("SW_FAILED_X");
    expect(codes.size).toBeGreaterThan(30);
    for (const code of codes) {
      const field = g4Guides.find((x) => x.match.code === code)?.match.field;
      const g = matchGuide({ route: "/x", search: "", code, field });
      expect({ code, guide: g.id.startsWith("g4-") }).toEqual({ code, guide: true });
    }
  });

  test("every G4 guide resolves with a link that is a same-origin path", () => {
    for (const g of g4Guides) {
      const code = g.match.code!;
      const r = resolveGuide(g, { route: "/scope/abc", search: "?projectId=p1", code, field: g.match.field, serverMessage: "words" });
      expect(r.what).not.toContain("{serverMessage}");
      if (r.fix) {
        expect(r.fix.href.startsWith("/")).toBe(true);
        expect(r.fix.href.startsWith("//")).toBe(false);
      }
    }
  });

  test("the sign-in-again links bring the person back to the same page WITH its query", () => {
    const r = resolveGuide(matchGuide({ route: "/scope/abc/budget", search: "?projectId=p1&line=l9", code: "SESSION_ENDED" }), { route: "/scope/abc/budget", search: "?projectId=p1&line=l9", code: "SESSION_ENDED" });
    const url = new URL(r.fix!.href, "https://x.test");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("redirectTo")).toBe("/scope/abc/budget?projectId=p1&line=l9");
  });
});
