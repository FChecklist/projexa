// R67 WS-A (A-05) -- MODE IS DERIVED, NOT CHOSEN.
//
// The composer used to carry a `mode` in React state, sticky in sessionStorage
// under "veri.chain.mode", set by a row of three tabs at the head of the
// control strip: Projects | Customers | Vendors. On PROJEXA those tabs changed
// nothing but their own colour -- every chain here is project-rooted -- so the
// user was given a control whose only effect was to look like a decision.
//
// The value itself is not dead: POST /api/v1/projexa/tasks stores it on the
// submission row. But it is a FACT ABOUT THE CHAIN, not a preference: a chain
// whose first step is Customers is a customers chain whether or not anyone
// clicked a tab. Deriving it deletes the control, the storage key and the
// state without changing one byte of the request body.

import type { ChainMode } from "@fchecklist/veridian-ui-kit/shell";

/** The shape this needs from a chain segment, so the helper stays pure and
 *  does not drag the kit's whole Chain type through every caller. */
export type ModeSegment = { id: string; kind?: string };

/**
 * The chain's mode, from the chain itself: the first segment the user actually
 * chose (the project root is not a choice) decides it. Anything that is not
 * customers or vendors is a project chain, which is also the empty case --
 * matching DEFAULT_CHAIN_MODE, so a fresh composer sends exactly what it sent
 * before.
 */
export function deriveMode(segments: readonly ModeSegment[]): ChainMode {
  const first = segments.find((s) => s.kind !== "root");
  const id = (first?.id ?? "").trim().toLowerCase();
  if (id === "customers" || id === "customer") return "customers";
  if (id === "vendors" || id === "vendor") return "vendors";
  return "projects";
}
