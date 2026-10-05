#!/usr/bin/env node
// AUDIT-100 B52: does the PROJEXA AI Link extension still find the message box on the REAL chat sites?
//
// Reads the extension's own selector list (extension/projexa-ai-link/content.js, BOX_SELECTORS), opens each chat site ONCE in a fresh browser
// profile (no login, no cookies of anyone, nothing typed, nothing sent, no work link anywhere), waits for the page's message box and reports,
// per site, which extension selector matches it now. A site whose own selector no longer matches is DRIFT (exit 1): the extension would fall
// back to another selector or find nothing there.
//
//   node scripts/verify/chat-site-selectors.mjs              report only
//   node scripts/verify/chat-site-selectors.mjs --capture    also rewrite e2e/fixtures/chat-sites/<site>.html from what the live page shows
//   PX_CHANNEL=msedge (default) | chrome | chromium          which installed browser Playwright drives
//
// Run by hand, never in CI: it needs the public internet and the sites change without notice. A site that shows a login page instead of a
// message box is reported as LOGIN-WALL (not drift): its fixture then keeps the structure the selector comments describe (see the fixture's header).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTENT_JS = path.join(ROOT, "extension", "projexa-ai-link", "content.js");
const FIXTURES = path.join(ROOT, "e2e", "fixtures", "chat-sites");

/** The live sites, with the selector (by `site` name in BOX_SELECTORS) that is meant to find each one's box. */
export const SITES = [
  { site: "chatgpt", url: "https://chatgpt.com/", own: "chatgpt" },
  { site: "claude", url: "https://claude.ai/new", own: "claude" },
  { site: "gemini", url: "https://gemini.google.com/app", own: "gemini" },
  { site: "deepseek", url: "https://chat.deepseek.com/", own: "deepseek" },
  { site: "zai", url: "https://chat.z.ai/", own: "zai" },
];

export function readSelectors(file = CONTENT_JS) {
  const src = fs.readFileSync(file, "utf8");
  const m = src.match(/var BOX_SELECTORS = (\[[\s\S]*?\n\s*\]);/);
  if (!m) throw new Error("BOX_SELECTORS not found in content.js");
  return new Function(`return ${m[1]};`)();
}

/** Runs IN the page: the message box candidates, which extension selector picks which element, and a minimal, script-free snapshot. */
function inspect(selectors) {
  const KEEP = new Set(["id", "class", "role", "contenteditable", "placeholder", "aria-label", "aria-multiline", "data-placeholder", "name", "translate", "rows", "dir", "type", "enterkeyhint"]);
  const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""], rich-textarea')].filter((e) => {
    const r = e.getBoundingClientRect();
    return e.tagName === "RICH-TEXTAREA" || (r.width > 0 && r.height > 0) || e.tagName === "TEXTAREA";
  });
  const picks = selectors.map((s) => {
    const all = [...document.querySelectorAll(s.css)];
    return { site: s.site, css: s.css, matches: all.length, first: all[0] ? `${all[0].tagName.toLowerCase()}${all[0].id ? "#" + all[0].id : ""}` : null };
  });
  // the extension's own order (content.js orderFor): this host's selectors first, then the rest in list order
  const ordered = [...selectors.filter((s) => (s.hosts ?? []).includes(location.hostname)), ...selectors.filter((s) => !(s.hosts ?? []).includes(location.hostname))];
  let firstHit = null;
  for (const s of ordered) {
    const el = document.querySelector(s.css);
    if (el) { firstHit = s.site; break; }
  }
  let snapshot = null;
  const box = candidates.find((e) => e.tagName !== "RICH-TEXTAREA");
  if (box) {
    // the composer's form, or (no form) four levels up: enough structure for every selector in the list (e.g. "rich-textarea div[...]")
    let root = box.closest("form");
    if (!root) { root = box; for (let i = 0; i < 4 && root.parentElement && root.parentElement !== document.body; i++) root = root.parentElement; }
    const keepEls = [...root.querySelectorAll('textarea, [contenteditable], rich-textarea')];
    if (root.matches('textarea, [contenteditable]')) keepEls.push(root);
    const clone = root.cloneNode(true);
    const origAll = [root, ...root.querySelectorAll("*")];
    const cloneAll = [clone, ...clone.querySelectorAll("*")];
    const keepIdx = new Set();
    origAll.forEach((el, i) => { if (keepEls.some((k) => k === el || el.contains(k) || k.contains(el))) keepIdx.add(i); });
    cloneAll.forEach((el, i) => {
      if (!keepIdx.has(i)) { el.remove(); return; }
      for (const a of [...el.attributes]) if (!KEEP.has(a.name)) el.removeAttribute(a.name);
    });
    for (const el of [...clone.querySelectorAll("script, style, svg, img, button, link, iframe")]) el.remove();
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const t of texts) t.textContent = "";
    snapshot = clone.outerHTML;
  }
  return {
    title: document.title,
    path: location.pathname,
    candidates: candidates.map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.getAttribute("role") ? "[role=" + e.getAttribute("role") + "]" : ""}${e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 4).join(".") : ""}`),
    picks,
    firstHit,
    snapshot,
  };
}

async function main() {
  const capture = process.argv.includes("--capture");
  const only = process.argv.find((a) => a.startsWith("--site="))?.slice(7);
  const selectors = readSelectors();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-chat-sites-"));
  const context = await chromium.launchPersistentContext(dir, { channel: process.env.PX_CHANNEL ?? "msedge", headless: true, viewport: { width: 1280, height: 900 } });
  const today = new Date().toISOString().slice(0, 10);
  const report = [];
  try {
    for (const s of SITES.filter((x) => !only || x.site === only)) {
      const page = await context.newPage();
      let row;
      try {
        await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 25_000 }).catch(() => null);
        await page.waitForTimeout(1500);
        const r = await page.evaluate(inspect, selectors);
        const ownPick = r.picks.find((p) => p.site === s.own);
        const status = r.candidates.length === 0 ? "LOGIN-WALL-OR-NO-BOX" : ownPick && ownPick.matches > 0 && r.firstHit === s.own ? "OK" : "DRIFT";
        row = { site: s.site, url: s.url, landed: page.url(), title: r.title, status, firstHit: r.firstHit, own: s.own, picks: r.picks, candidates: r.candidates };
        if (capture && r.snapshot && status !== "LOGIN-WALL-OR-NO-BOX") {
          fs.mkdirSync(FIXTURES, { recursive: true });
          const head = `<!-- AUDIT-100 B52 fixture: the message box of ${s.url} as the LIVE page showed it on ${today}, without a login (fresh profile, no cookies,\n     nothing typed or sent), captured by scripts/verify/chat-site-selectors.mjs --capture. Scripts, styles, icons, buttons, text and every\n     attribute outside a short list (id, class, role, contenteditable, placeholder, aria-*, name...) are stripped: no personal data, no tokens.\n     Landed on: ${page.url()}  Extension selector that picks it: ${r.firstHit} -->\n`;
          fs.writeFileSync(path.join(FIXTURES, `${s.site}.html`), `${head}<!doctype html><html><head><meta charset="utf-8"><title>${s.site} fixture</title></head><body>${r.snapshot}</body></html>\n`);
          row.captured = true;
        }
      } catch (e) {
        row = { site: s.site, url: s.url, status: "UNREACHABLE", error: String(e).slice(0, 200) };
      }
      report.push(row);
      await page.close();
    }
  } finally {
    await context.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const r of report) {
    console.log(`${r.status.padEnd(22)} ${r.site.padEnd(9)} ${r.url}  landed=${r.landed ?? "-"}  picked-by=${r.firstHit ?? "-"} (own: ${r.own ?? "-"})${r.captured ? "  [fixture written]" : ""}`);
    if (r.picks) for (const p of r.picks) console.log(`    ${p.matches > 0 ? "match" : "  -  "} ${p.site.padEnd(8)} ${p.css}  (${p.matches})`);
    if (r.candidates?.length) console.log(`    boxes on page: ${r.candidates.join(", ")}`);
    if (r.error) console.log(`    ${r.error}`);
  }
  if (process.env.PX_REPORT_JSON) fs.writeFileSync(process.env.PX_REPORT_JSON, JSON.stringify(report, null, 2));
  process.exit(report.some((r) => r.status === "DRIFT") ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
