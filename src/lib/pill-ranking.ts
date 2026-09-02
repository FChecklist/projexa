// R67 WS-A (A-14) -- WHEN A NEWLY ARRIVED RANKING MAY REPLACE WHAT IS ON SCREEN.
//
// THE ANSWER IS: NEVER, WHILE THE USER IS LOOKING AT IT.
//
// The strip's order comes from the server, and the server answers some
// hundreds of milliseconds after the page paints. Applying its answer the
// moment it lands re-orders the cards under whatever the user is already
// reaching for, which is how a person aiming at "Run WPR" presses "Record
// progress" instead -- and on this product that is a write against the wrong
// thing. A-07 softened this with a five-second "has the band been touched"
// window; A-14 replaces the window with the rule it was approximating: the
// strip re-ranks ONLY on a navigation, which is the one moment the user has
// already looked away, and only when the server actually answered. Until then
// the cached ranking (or, for a first-ever visit, this role's own cold-start
// order) stands.
//
// THE ONE EXCEPTION IS AN EMPTY STRIP. If nothing at all has been painted --
// no cached ranking from a previous visit and no role yet to order the
// catalogue by -- there is nothing to protect and skeletons are showing, so an
// arriving ranking is painted at once. Holding it back there would leave a new
// user staring at placeholders until they happened to navigate.
//
// Both halves are pure and exported so the rule is written down once and can
// be asserted without a browser, rather than living only inside an effect.

/** One entry of the server's ranking, as PROJEXA's proxy returns it. */
export type RankingEntry = { pillKey: string };

/**
 * Is there anything real on screen yet? A cached ranking counts, and so does a
 * known role -- with a role the strip is already painting that role's own
 * ordering of the catalogue, which is a considered answer and not a
 * placeholder.
 */
export function isStripPainted(input: { cachedRanking: unknown | null; roleKnown: boolean }): boolean {
  return input.cachedRanking !== null || input.roleKnown;
}

/**
 * What to do with a ranking the server has just sent.
 *   "paint"  nothing is on screen -- show it now.
 *   "defer"  hold it, and let the next navigation put it in place.
 */
export function rankingArrival(input: { painted: boolean }): "paint" | "defer" {
  return input.painted ? "defer" : "paint";
}
