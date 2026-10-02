// R11, the fourth door: an agent that drives the PAGE (reads the accessibility tree, clicks by name) needs the main
// controls to keep the accessible names docs/local-first/BROWSER_AI.md promises it. Those components need the private
// UI kit to render, so this guard reads their source: if a promised name or role disappears, this fails and the doc
// must be updated on purpose. (Each component's own behaviour is covered by its own tests under src/components/shell.)

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

export const ARIA_CONTRACT: { file: string; markers: string[] }[] = [
  { file: "src/components/shell/LeftScreenCompletion.tsx", markers: ['role="tablist"', 'aria-label="Left panel views"', 'role="tab"', 'aria-label="Back one step"', 'aria-label="Reset the chain"'] },
  { file: "src/components/shell/PillStrip.tsx", markers: ['role="group" aria-label="Things you can do"'] },
  { file: "src/components/shell/Composer.tsx", markers: ['aria-label="Describe the task"'] },
  { file: "src/components/shell/TopRail.tsx", markers: ['role="listbox"', 'aria-label="Switch project"', 'role="option"'] },
  { file: "src/components/shell/TaskMaster.tsx", markers: ['role="tablist"'] },
  { file: "src/lib/local-first/ai/AiAttach.tsx", markers: ['aria-label="Requests from your AI"', 'id="px-ai-manual"'] },
];

describe("the accessible names browser agents rely on", () => {
  for (const { file, markers } of ARIA_CONTRACT) {
    test(file, () => {
      const src = read(file);
      for (const m of markers) expect({ file, marker: m, present: src.includes(m) }).toEqual({ file, marker: m, present: true });
    });
  }

  test("every marker is named in docs/local-first/BROWSER_AI.md", () => {
    const doc = read("docs/local-first/BROWSER_AI.md");
    for (const { markers } of ARIA_CONTRACT) {
      for (const m of markers) {
        const name = /aria-label="([^"]+)"/.exec(m)?.[1];
        if (name) expect({ name, documented: doc.includes(name) }).toEqual({ name, documented: true });
      }
    }
  });
});
