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

/**
 * "Choose a .dwg, .dxf or .pdf file" when the chosen file's extension is not
 * one this field takes. The accept attribute is a filter, not a guarantee --
 * every OS file picker lets a user switch it off.
 */
export function fileTypeError(fileName: string | null, extensions: readonly string[]): string | undefined {
  if (!fileName) return undefined;
  const dot = fileName.lastIndexOf(".");
  const ext = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  return extensions.includes(ext) ? undefined : `Choose a ${describeExtensions(extensions)} file`;
}
