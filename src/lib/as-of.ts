// R67 F-22 -- "as of HH:MM".
//
// When a screen renders rows it prefetched speculatively, those rows can be up
// to a minute old. Showing them as if they were current would be a small lie
// told for speed; showing WHEN they were read costs four characters and makes
// the speed honest. The live revalidation running underneath removes the stamp
// as soon as it lands.
//
// The clock is the READER'S local one, not the pinned en-US/UTC formatter in
// format-date.ts: that formatter exists so stored dates render identically for
// everyone, whereas this is "how long ago did this happen to me", which is
// only meaningful in the time the reader's own wall clock shows.

/** 24-hour HH:MM in the reader's local time. */
export function formatAsOf(timestamp: number | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** The whole sentence, so every screen says it the same way. */
export function asOfLabel(timestamp: number | Date): string {
  const time = formatAsOf(timestamp);
  return time ? `as of ${time}` : "";
}
