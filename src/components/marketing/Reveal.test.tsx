/// <reference types="bun-types" />
// R67 J-02 (audit R-279). The finding was that every section below the hero
// on "/" and /how-it-works was `opacity: 0` in the server HTML and only
// became visible if client JavaScript ran an IntersectionObserver -- so a
// no-JS or reduced-motion visitor got the hero followed by a page-height of
// blank background.
//
// The first test is the acceptance clause itself ("JavaScript disabled"):
// it renders the component the way a server does, with no client runtime at
// all, and asserts the painted state. The rest pin the enhancement: it must
// not arm under reduced motion, and it must not hide a section the viewer is
// already looking at.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, render } from "@testing-library/react";
import { Reveal } from "./Reveal";

afterEach(() => {
  cleanup();
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

/** Replaces window.matchMedia so the reduced-motion answer is ours. */
function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    // The component asks for "no-preference"; under reduced motion that is
    // exactly the query that must not match.
    matches: query.includes("no-preference") ? !reduced : reduced,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Pins where the section sits relative to the fold. */
function setSectionTop(top: number) {
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON() {} };
  } as unknown as typeof Element.prototype.getBoundingClientRect;
}

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;

/** Captures the observer callback so a scroll-into-view can be simulated. */
function installIntersectionObserver(): { fire: (isIntersecting: boolean) => void } {
  let captured: ObserverCallback | null = null;
  class FakeIntersectionObserver {
    constructor(callback: ObserverCallback) {
      captured = callback;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
  return {
    fire(isIntersecting: boolean) {
      act(() => captured?.([{ isIntersecting }]));
    },
  };
}

describe("Reveal", () => {
  test("the server HTML -- what a no-JS visitor gets -- is painted, not transparent", () => {
    const html = renderToStaticMarkup(
      <Reveal delay={120} id="section-under-test">
        <p>Every deadline, drawing and decision.</p>
      </Reveal>
    );
    expect(html).toContain("opacity-100");
    expect(html).toContain("translate-y-0");
    expect(html).not.toContain("opacity-0");
    expect(html).not.toContain("translate-y-6");
    // No transition either: nothing is animating, so nothing should claim to.
    expect(html).not.toContain("transition-all");
    // And the content is really in the document, not deferred behind a flag.
    expect(html).toContain("Every deadline, drawing and decision.");
  });

  test("keeps the caller's own classes and id", () => {
    const html = renderToStaticMarkup(
      <Reveal className="mt-9" id="pays-for-itself">
        <p>x</p>
      </Reveal>
    );
    expect(html).toContain('id="pays-for-itself"');
    expect(html).toContain("mt-9");
  });

  test("under prefers-reduced-motion: reduce it stays painted after hydration", () => {
    setReducedMotion(true);
    setSectionTop(4000); // far below the fold: the one case that would arm
    installIntersectionObserver();

    const { container } = render(
      <Reveal>
        <p>below the fold</p>
      </Reveal>
    );
    const section = container.firstElementChild!;
    expect(section.className).toContain("opacity-100");
    expect(section.className).not.toContain("opacity-0");
  });

  test("with motion allowed, a section already on screen is never hidden", () => {
    setReducedMotion(false);
    setSectionTop(10); // above the fold -- the viewer is looking at it
    installIntersectionObserver();

    const { container } = render(
      <Reveal>
        <p>hero-adjacent</p>
      </Reveal>
    );
    expect(container.firstElementChild!.className).toContain("opacity-100");
  });

  test("with motion allowed, an off-screen section arms and then reveals on scroll", () => {
    setReducedMotion(false);
    setSectionTop(4000);
    const observer = installIntersectionObserver();

    const { container } = render(
      <Reveal delay={120}>
        <p>far below</p>
      </Reveal>
    );
    const section = container.firstElementChild!;
    expect(section.className).toContain("opacity-0");
    expect(section.className).toContain("motion-safe:transition-all");

    observer.fire(true);
    expect(section.className).toContain("opacity-100");
    expect(section.getAttribute("style")).toContain("120ms");
  });

  test("no IntersectionObserver at all still leaves the section painted", () => {
    setReducedMotion(false);
    setSectionTop(4000);
    // deliberately not installing one

    const { container } = render(
      <Reveal>
        <p>no observer</p>
      </Reveal>
    );
    expect(container.firstElementChild!.className).toContain("opacity-100");
  });
});
