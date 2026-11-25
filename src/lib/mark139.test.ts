// Owner order 25 Nov 2026: the small mark "१३९" at the very top centre of every page. This guard scans every
// page source this repo produces (layouts, standalone HTML files, HTML strings in routes/middleware/worker)
// and fails if one lacks exactly one mark element or if the approved CSS/numerals differ.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const MARK = '<div class="mark139" lang="hi" aria-hidden="true"><span>१३९</span></div>';
const CSS_MAIN =
  '.mark139{position:absolute;top:0;left:0;right:0;margin:0;padding:1px 0 0;text-align:center;line-height:1;pointer-events:none;user-select:none;z-index:2147483647;font-family:"Noto Sans Devanagari","Mukta","Nirmala UI","Mangal","Kohinoor Devanagari","Devanagari Sangam MN",sans-serif;font-size:6px;font-weight:700;color:#0B2A6B}';
const CSS_SPAN = ".mark139 span{display:inline-block;border-bottom:.5px solid #7A1010;padding-bottom:.5px}";

// [file, number of pages built in it, whether the CSS lives in the file itself (else in globals.css)]
const PAGES: Array<[string, number, boolean]> = [
  ["src/app/layout.tsx", 1, false], // root layout: covers every app page and the not-found page
  ["src/app/global-error.tsx", 1, true],
  ["src/middleware.ts", 1, true],
  ["src/lib/local-first/release/sw-core.ts", 1, true],
  ["src/app/api/email/[token]/route.ts", 2, true],
  ["scripts/stage-static-pages.mjs", 1, true],
  ["public/connect-ai.html", 1, true],
  ["extension/projexa-ai-link/popup.html", 1, true],
];

const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const count = (s: string, needle: string) => s.split(needle).length - 1;
// JSX writes the same element with className=; accept either spelling but exactly once per page.
const jsx = (s: string) => s.replace("class=", "className=");

describe("mark139 on every page", () => {
  for (const [file, pages, ownCss] of PAGES) {
    test(`${file} has the mark exactly once per page`, () => {
      const src = read(file);
      const n = count(src, MARK) + count(src, jsx(MARK));
      expect(n).toBe(pages);
      expect(count(src, 'class="mark139"') + count(src, 'className="mark139"')).toBe(pages);
      if (ownCss) {
        expect(count(src, CSS_MAIN)).toBe(pages);
        expect(count(src, CSS_SPAN)).toBe(pages);
      }
    });
  }

  test("shared stylesheet carries the approved CSS once", () => {
    const css = read("src/app/globals.css");
    expect(count(css, CSS_MAIN)).toBe(1);
    expect(count(css, CSS_SPAN)).toBe(1);
  });

  test("approved look values are exact", () => {
    for (const s of ["#0B2A6B", "#7A1010", "6px", "700", ".5px", "१३९"]) {
      expect(CSS_MAIN + CSS_SPAN + MARK).toContain(s);
    }
  });
});
