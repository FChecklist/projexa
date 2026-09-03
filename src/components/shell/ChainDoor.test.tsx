/// <reference types="bun-types" />
// R67 WS-C (C-06) -- THE THREE DOORS, ASSERTED.
//
// R-170's finding is that the same work is reachable three ways and that the
// three disagreed. The catalogue's own tests (card-catalogue.test.ts) fix the
// SENTENCE and the DESTINATION; this file fixes the three behaviours a table
// of data cannot state:
//
//   1. a KPI value is a REAL LINK, with a real href -- not a button that
//      calls router.push, which cannot be middle-clicked or opened in a tab;
//   2. clicking it fills the strip, and does so with navigate:false so the
//      anchor and the shell do not both navigate;
//   3. a tile with nothing behind it renders its reason IN WORDS and is not
//      a link at all.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// NB: the module-level `screen` helper binds to document.body at IMPORT
// time, which is before GlobalRegistrator has made one; every query below
// therefore goes through render()'s own returned queries instead.
import { cleanup, fireEvent, render } from "@testing-library/react";

// ChainDoor renders next/link and useOpenDoor calls useRouter(). Outside a
// real Next app tree both reach for an app-router context that does not
// exist, so both are mocked before the component is imported. The router mock
// is also the assertion for rule 2: if the door ever navigated itself as well
// as rendering an anchor, `pushed` would be non-empty.
const pushed: string[] = [];
mock.module("next/navigation", () => ({ useRouter: () => ({ push: (url: string) => pushed.push(url) }) }));
mock.module("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ChainDoor } from "./ChainDoor";
import { ShellChainProvider, type ShellChainApi } from "./shell-chain-context";

afterEach(() => {
  cleanup();
  pushed.length = 0;
});

function shellSpy() {
  const opened: { doorId: string; opts?: { projectId?: string | null; navigate?: boolean } }[] = [];
  const api: ShellChainApi = {
    hasShell: true,
    loadChain: () => {},
    openDoor: (doorId, opts) => opened.push({ doorId, opts }),
    pushReceipt: () => {},
  };
  return { api, opened };
}

describe("ChainDoor", () => {
  test("a KPI value is a real link, with the door's own href", () => {
    const { api } = shellSpy();
    const view = render(
      <ShellChainProvider value={api}>
        <ChainDoor doorId="project.permits_expiring" projectId="p1">
          <span>3</span>
        </ChainDoor>
      </ShellChainProvider>
    );
    const link = view.getByRole("link");
    expect(link.getAttribute("href")).toBe("/permits?projectId=p1&withinDays=30");
    expect(link.textContent).toContain("3");
  });

  test("clicking it fills the strip, and lets the anchor do the navigating", () => {
    const { api, opened } = shellSpy();
    const view = render(
      <ShellChainProvider value={api}>
        <ChainDoor doorId="labour.mark_attendance" projectId="p1">
          <span>Mark attendance</span>
        </ChainDoor>
      </ShellChainProvider>
    );
    fireEvent.click(view.getByRole("link"));
    expect(opened).toEqual([{ doorId: "labour.mark_attendance", opts: { projectId: "p1", navigate: false } }]);
    // The shell must NOT have been asked to push as well -- two navigations
    // for one click is the defect, not the feature.
    expect(pushed).toEqual([]);
  });

  test("a tile with nothing behind it is words, not a dead number", () => {
    const { api, opened } = shellSpy();
    const view = render(
      <ShellChainProvider value={api}>
        <ChainDoor doorId="project.permits_expiring" projectId="p1" disabledReason="No permits on this project">
          <span>0</span>
        </ChainDoor>
      </ShellChainProvider>
    );
    expect(view.queryByRole("link")).toBeNull();
    expect(view.getByText("No permits on this project")).toBeTruthy();
    expect(opened).toEqual([]);
  });

  test("an unregistered door id renders its content untouched rather than a control to nowhere", () => {
    const { api } = shellSpy();
    const view = render(
      <ShellChainProvider value={api}>
        <ChainDoor doorId="not.a.door">
          <span>42</span>
        </ChainDoor>
      </ShellChainProvider>
    );
    expect(view.queryByRole("link")).toBeNull();
    expect(view.getByText("42")).toBeTruthy();
  });
});

describe("outside the shell", () => {
  test("the door still navigates -- a missing provider is not a dead control", () => {
    const view = render(
      <ChainDoor doorId="scope.new_boq" projectId="p9">
        <span>New BOQ</span>
      </ChainDoor>
    );
    const link = view.getByRole("link");
    expect(link.getAttribute("href")).toBe("/scope/new?projectId=p9");
    // The anchor carries the navigation here too; the no-op openDoor simply
    // has no strip to fill, and nothing throws.
    fireEvent.click(link);
    expect(pushed).toEqual([]);
  });
});
