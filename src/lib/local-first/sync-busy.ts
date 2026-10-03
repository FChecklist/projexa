// A leaf file (no imports) so the prepare screen can recognise the replica's "busy" answer without loading the whole replica.
/** The report message when another sync of this person (another tab, or a screen's own catch-up) holds the sync lock. Not a failure: that sync copies the same data. */
export const SYNC_BUSY_MESSAGE = "Another tab is already syncing.";
