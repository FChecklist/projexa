/// <reference types="bun-types" />
// Sumeet R-92 (right pane to left rail): the module the person is working in is marked in the rail on the laptop's copy of the screen too.
// The offline shell serves a module at /local/<module>; before the fix the rail compared that address with "/<module>" and marked nothing.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

let currentPath = "/scope";
mock.module("next/navigation", () => ({ usePathname: () => currentPath, useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams() }));
mock.module("next-intl", () => ({ useTranslations: () => (key: string) => key }));
mock.module("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import TraditionalMenu from "./TraditionalMenu";

afterEach(() => cleanup());

const marked = (container: HTMLElement) => Array.from(container.querySelectorAll('a[aria-current="page"]')).map((a) => a.getAttribute("href"));

describe("the module rail marks the module the right pane is showing", () => {
  test("on the online address", () => {
    currentPath = "/scope";
    expect(marked(render(<TraditionalMenu />).container)).toEqual(["/scope"]);
  });

  test("on the laptop's copy (/local/<module>) and on a screen inside it", () => {
    currentPath = "/local/scope";
    expect(marked(render(<TraditionalMenu />).container)).toEqual(["/scope"]);
    cleanup();
    currentPath = "/local/scope/abc123/revise";
    expect(marked(render(<TraditionalMenu />).container)).toEqual(["/scope"]);
  });

  test("a module whose name merely starts like another is not marked", () => {
    currentPath = "/local/work-progress";
    expect(marked(render(<TraditionalMenu />).container)).toEqual(["/work-progress"]);
  });
});
