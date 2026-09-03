"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Lightweight scroll-reveal: fades + lifts a section in the first time it
// crosses into the viewport. No animation library dependency (none is
// installed in this repo) -- just an IntersectionObserver toggling a class.
//
// R67 J-02 (audit R-279). WHAT WAS WRONG: the hidden state was the DEFAULT
// one. The component rendered `translate-y-6 opacity-0` and only flipped to
// `opacity-100` from a useEffect, so the server HTML for every section below
// the hero on "/" and /how-it-works was fully transparent, and the only
// thing that ever made it visible was client JavaScript running an
// IntersectionObserver. Anyone whose JS had not run (or had failed) saw the
// hero and then a page-height of empty background. The old comment here
// claimed prefers-reduced-motion was handled "via the transition duration
// being killed globally for that media query" -- globals.css has no such
// rule; the only reduced-motion guard in it is the one on @keyframes
// px-drift. A reduced-motion user got the transparent version too.
//
// THE FIX, in the order the audit words it: render visible by default
// (opacity 1, no transform, no transition), then treat the reveal as an
// enhancement that is armed only after hydration and only under
// `prefers-reduced-motion: no-preference`. The Tailwind classes carry a
// `motion-safe:` guard as well, so the media query decides in CSS too, not
// just in JS.
//
// AND ONLY FOR SECTIONS THAT ARE STILL OFF-SCREEN: arming a section the
// viewer is already looking at would make it vanish and fade back in on
// every load. Hiding something already painted is a worse defect than not
// animating it, so a section whose top is above the fold at mount stays put
// for good.
type RevealState =
  // Painted, no animation involved. The server render, the no-JS render, and
  // the reduced-motion render all stop here.
  | "static"
  // Hydrated, motion is welcome, and this section is below the fold: hidden,
  // waiting to be scrolled to.
  | "armed"
  // Scrolled into view; transitioned in and finished.
  | "revealed";

export function Reveal({
  children,
  className,
  delay = 0,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RevealState>("static");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    if (typeof IntersectionObserver !== "function") return;

    // Already on screen (or scrolled past): leave it painted.
    if (node.getBoundingClientRect().top < window.innerHeight) return;

    setState("armed");

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setState("revealed");
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const hidden = state === "armed";

  return (
    <div
      ref={ref}
      id={id}
      style={state === "revealed" && delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        state !== "static" && "motion-safe:transition-all motion-safe:duration-700 motion-safe:ease-out",
        hidden ? "translate-y-6 opacity-0" : "translate-y-0 opacity-100",
        className
      )}
    >
      {children}
    </div>
  );
}
