/// <reference types="bun-types" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { beforeEach, describe, expect, test } from "bun:test";
import { applySnapshot, collectFields, discardSnapshot, peekSnapshot, saveSnapshot, snapshotThisPage, snapshotUrl, SNAPSHOT_TTL_MS } from "./form-snapshot";

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

function page(html: string) {
  document.body.innerHTML = html;
}

beforeEach(() => page(""));

describe("form snapshot", () => {
  test("collects typed values, never passwords, files, hidden fields, one-time codes or opted-out fields", () => {
    page(`<form>
      <label for="t">Title</label><input id="t" value="Kitchen">
      <input name="qty" type="number" value="12">
      <textarea aria-label="Notes">long note</textarea>
      <input type="password" id="p" value="secret"><input type="hidden" name="h" value="x">
      <input id="code" autocomplete="one-time-code" value="123456">
      <div data-px-no-snapshot><input id="skip" value="no"></div>
      <input id="empty" value="">
      <select id="s"><option value="a">A</option><option value="b" selected>B</option></select>
    </form>`);
    expect(collectFields(document)).toEqual({ "text:t": "Kitchen", "number:qty": "12", "textarea:Notes": "long note", "select:s": "b" });
  });

  test("restores into EMPTY fields only, through events a React form sees, and never overwrites", () => {
    page(`<input id="a" value=""><input id="b" value="typed after sign-in">`);
    const seen: string[] = [];
    document.getElementById("a")!.addEventListener("input", () => seen.push("input"));
    const r = applySnapshot(document, { "text:a": "restored", "text:b": "old", "text:gone": "x" });
    expect((document.getElementById("a") as HTMLInputElement).value).toBe("restored");
    expect((document.getElementById("b") as HTMLInputElement).value).toBe("typed after sign-in");
    expect(seen).toEqual(["input"]);
    expect(r.filled).toEqual(["text:a"]);
    expect(r.missing).toEqual(["text:gone"]);
  });

  test("a snapshot is kept per page address, expires after 2 hours and is removed when discarded", () => {
    const st = new MemStore();
    expect(saveSnapshot("/scope/a?projectId=p1", { k: "v" }, "signed-out", st, 1000)).toBe(true);
    expect(peekSnapshot("/scope/a?projectId=p1", st, 1000 + 5)?.fields).toEqual({ k: "v" });
    expect(peekSnapshot("/scope/a?projectId=p2", st, 1000 + 5)).toBeNull();
    expect(peekSnapshot("/scope/a?projectId=p1", st, 1000 + SNAPSHOT_TTL_MS)).toBeNull();
    saveSnapshot("/x", { k: "v" }, "r", st, 1);
    discardSnapshot("/x", st);
    expect(peekSnapshot("/x", st, 2)).toBeNull();
    expect(saveSnapshot("/y", {}, "r", st)).toBe(false); // nothing typed = nothing kept
  });

  test("the key ignores the return marker and highlight but keeps the query that matters", () => {
    expect(snapshotUrl({ pathname: "/scope/a/budget", search: "?projectId=p1&returnTo=r1&focus=x&line=l9" })).toBe("/scope/a/budget?projectId=p1&line=l9");
  });

  test("snapshotThisPage copies the page just before leaving, under the page's own address", () => {
    page(`<input id="title" value="Half-written">`);
    const st = new MemStore();
    const n = snapshotThisPage("signed-out", { location: { pathname: "/rfis/new", search: "?projectId=p1" } as Location, document }, st, 5);
    expect(n).toBe(1);
    expect(peekSnapshot("/rfis/new?projectId=p1", st, 6)?.fields).toEqual({ "text:title": "Half-written" });
  });
});
