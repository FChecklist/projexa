import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { beforeAll, describe, expect, test } from "bun:test";
import { historyUrlFor, interceptLinkClick } from "./router";

// The document's own address, so a link's resolved href has a real origin to compare with.
beforeAll(() => {
  (window as unknown as { happyDOM?: { setURL(url: string): void } }).happyDOM?.setURL("https://px.test/local");
});

const current = (pathname: string) => ({ pathname, origin: "https://px.test", href: `https://px.test${pathname}` });

describe("history URLs keep the person under the prefix they are on", () => {
  test("under /local stays under /local; on a real app URL stays on real app URLs", () => {
    expect(historyUrlFor("/scope/abc?projectId=p1", current("/local/scope"))).toBe("/local/scope/abc?projectId=p1");
    expect(historyUrlFor("/", current("/local/scope"))).toBe("/local");
    expect(historyUrlFor("/scope/abc", current("/scope"))).toBe("/scope/abc");
    expect(historyUrlFor("/local/scope/abc", current("/local"))).toBe("/local/scope/abc");
    expect(historyUrlFor("https://px.test/scope?x=1", current("/local"))).toBe("/local/scope?x=1");
  });
});

function anchor(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  const inner = document.createElement("span");
  a.appendChild(inner);
  document.body.appendChild(a);
  return a;
}

function click(target: Element, over: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }> = {}) {
  let prevented = false;
  const event = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target, preventDefault() { prevented = true; }, ...over };
  const went: string[] = [];
  const handled = interceptLinkClick(event, (href) => went.push(href), window.location.origin);
  return { handled, prevented, went };
}

describe("links inside the shell are intercepted", () => {
  test("a plain click on a link to an app page (or on something inside it) is a shell navigation", () => {
    const a = anchor(`${window.location.origin}/scope/abc?projectId=p1`);
    const direct = click(a);
    expect(direct).toEqual({ handled: true, prevented: true, went: ["/scope/abc?projectId=p1"] });
    const inner = click(a.firstChild as Element);
    expect(inner.went).toEqual(["/scope/abc?projectId=p1"]);
  });

  test("everything the browser should handle itself is left alone", () => {
    const origin = window.location.origin;
    const cases: [string, ReturnType<typeof click>][] = [
      ["modified click", click(anchor(`${origin}/scope`), { metaKey: true })],
      ["ctrl click", click(anchor(`${origin}/scope`), { ctrlKey: true })],
      ["shift click", click(anchor(`${origin}/scope`), { shiftKey: true })],
      ["middle button", click(anchor(`${origin}/scope`), { button: 1 })],
      ["already handled", click(anchor(`${origin}/scope`), { defaultPrevented: true })],
      ["new tab", click(anchor(`${origin}/scope`, { target: "_blank" }))],
      ["download", click(anchor(`${origin}/scope.csv`, { download: "" }))],
      ["another origin", click(anchor("https://elsewhere.test/scope"))],
      ["an API url", click(anchor(`${origin}/api/projects`))],
      ["a file", click(anchor(`${origin}/logo-mark.svg`))],
      ["not a link at all", click(document.createElement("div"))],
    ];
    for (const [name, result] of cases) expect(`${name}: ${result.handled}/${result.prevented}`).toBe(`${name}: false/false`);
  });
});
