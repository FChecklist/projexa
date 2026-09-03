// R67 WS-A (A-06, A-09) -- WHAT SURVIVES A NAVIGATION.
//
// THE DEFECT. The composer's strip carried whatever the user had last built,
// anywhere in the app. Arriving on /permits it still read "Work Progress × >
// New entry ×" -- a sentence describing another module's task, sitting under a
// Permits heading, with its (×) controls still offering to edit it. And a chain
// LOADED from the Task Master's History tab had the same problem in reverse:
// clearing it the moment the user arrived would delete the very thing the click
// had just restored.
//
// So there are three outcomes, not two, and which one applies depends on
// where the sentence CAME FROM -- not on what it says:
//
//   keep            The user is arriving at the loaded chain's own route (the
//                   navigation the load itself asked for), or they have PINNED
//                   it, which is the only way to say "I mean to carry this".
//   clear-all       A loaded chain, and the user has gone somewhere else. The
//                   whole sentence belonged to another screen -- and so did any
//                   text typed against it.
//   clear-segments  An ordinary navigation. The segments were built on the last
//                   screen and go with it; the DRAFT stays, because words a
//                   person typed are theirs and deleting them because they
//                   navigated is the composer editing the user's input.
//
// It is a pure function so all three can be asserted without a browser, and so
// the rule is written down once rather than re-derived inside an effect.

export type LoadedChainFacts = {
  /** The route the loaded chain belongs to, normalised. Null when unknown. */
  route: string | null;
  /** The user has explicitly pinned it to carry across screens. */
  pinned: boolean;
};

export type NavigationOutcome = "keep" | "clear-all" | "clear-segments";

export function navigationOutcome(input: {
  /** Null when the chain on screen was built here rather than loaded. */
  loaded: LoadedChainFacts | null;
  /** The pathname being navigated TO, normalised (no query, no hash). */
  nextPathname: string;
}): NavigationOutcome {
  const { loaded, nextPathname } = input;
  if (!loaded) return "clear-segments";
  if (loaded.pinned) return "keep";
  if (loaded.route !== null && loaded.route === nextPathname) return "keep";
  return "clear-all";
}
