// R67 D-09. One place for "is this file allowed, and how do we say so".
//
// The permit form (D-06) already had exactly these two rules and exactly this
// wording -- a size stated in the same units as the limit, with a decimal only
// where rounding would otherwise produce the nonsense "This file is 10 MB; the
// limit is 10 MB". The drawings form needs the same rules with a different
// limit, so the rules move here rather than being copied with a new number in
// them. PermitCreateClient's own exports are now thin wrappers over these, so
// its tests and its call sites are unchanged.
//
// Deliberately NOT "use client": these are pure functions over numbers and
// strings, and a server component that wants to state a limit should be able
// to import them too.

/**
 * R67 D-78. The two strings the three upload screens show when the SERVER
 * cannot accept a file at all -- no service-role key, or no bucket.
 *
 * They live here, not next to the probe in src/lib/storage-status.ts, for one
 * mechanical reason: that module imports veridian-client, which reads the
 * database and holds the org's Bearer key, so importing it from a client
 * component would pull a server module into the browser bundle. These are plain
 * strings; the module that reads the status is server-only and imports them from
 * here too, so there is still exactly one copy of each sentence.
 */
export const STORAGE_UNAVAILABLE_BANNER =
  "File storage is not configured on this server — uploads will fail";

export const STORAGE_UNAVAILABLE_REASON = "file storage not configured";

/**
 * The file's size in the same unit as the limit. One decimal place is used
 * only when a whole-number rounding would land exactly on the limit -- a
 * 10.4 MB file refused by a 10 MB limit must not read "10 MB".
 */
export function describeFileSize(bytes: number, limitMb: number): string {
  const mb = bytes / (1024 * 1024);
  const rounded = Math.round(mb);
  return `${rounded === limitMb ? mb.toFixed(1) : String(rounded)} MB`;
}

/** Both numbers, in the user's words, before the upload rather than after it. */
export function fileSizeError(bytes: number | null, limitMb: number): string | undefined {
  if (bytes === null) return undefined;
  return bytes > limitMb * 1024 * 1024
    ? `This file is ${describeFileSize(bytes, limitMb)}; the limit is ${limitMb} MB`
    : undefined;
}

/** ".dwg, .dxf or .pdf" -- the list a person reads, not the accept attribute. */
export function describeExtensions(extensions: readonly string[]): string {
  if (extensions.length === 0) return "";
  if (extensions.length === 1) return extensions[0];
  return `${extensions.slice(0, -1).join(", ")} or ${extensions[extensions.length - 1]}`;
}

/** ".pdf" from "DEWA_permit_2026.pdf", lower-cased; "" when there is no extension. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

/**
 * "Choose a .dwg, .dxf or .pdf file — this is a .png" when the chosen file's
 * extension is not one this field takes. The accept attribute is a filter, not a
 * guarantee -- every OS file picker lets a user switch it off, and a file dropped
 * on a drop zone never passes through the picker at all.
 *
 * R67 D-78 adds the second clause. "Choose a .dwg file" on its own leaves the
 * user comparing the sentence with a file name they can no longer see; naming
 * what they actually chose is the difference between a correction and a riddle.
 * A file with no extension is not accused of being one -- the message is then
 * just the first clause.
 */
export function fileTypeError(fileName: string | null, extensions: readonly string[]): string | undefined {
  if (!fileName) return undefined;
  const ext = fileExtension(fileName);
  if (extensions.includes(ext)) return undefined;
  const wanted = `Choose a ${describeExtensions(extensions)} file`;
  return ext ? `${wanted} — this is a ${ext}` : wanted;
}
