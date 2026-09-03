// R67 WS-C (C-07) -- WHAT A MODULE WILL ACCEPT, AND WHAT IT SAYS WHEN IT
// WILL NOT.
//
// R-163's finding: the composer's input band has an attach slot the product
// never filled, so the only way to get a file into PROJEXA is to find the
// module's own create form first. And when a file IS rejected, it is rejected
// after the upload, by a server, in a sentence nobody wrote.
//
// THE RULE THIS FILE ENFORCES: *** THE LIMITS ARE IN THE LABEL, AND THE
// REFUSAL IS IN WORDS, BEFORE ANY BYTES MOVE. *** The button reads "Attach
// PDF, up to 25 MB" rather than a paperclip; a 30 MB file is refused with
// "Too large: 30 MB, limit 25 MB" in the browser, so the user learns the
// limit from the control instead of from a failure.
//
// PURE. No React, no fetch, no DOM -- every sentence below is asserted in
// attachments.test.ts rather than eyeballed on a screen.

/** One mebibyte. Labelled "MB" because that is what a person reads on a file. */
export const MB = 1024 * 1024;

export type AttachPolicy = {
  /**
   * The word-button's own label, LIMITS INCLUDED. M24: "NOTHING ON THE STRIP
   * IS AN ICON-ONLY CONTROL. Every one is a word." A paperclip is a puzzle;
   * "Attach PDF, up to 25 MB" is an instruction.
   */
  label: string;
  /** Extensions, lower case, dot included. Also the input's accept attribute. */
  accept: readonly string[];
  /** How the accepted types read inside a sentence: "a PDF", "an Excel (.xlsx) file". */
  acceptWords: string;
  maxBytes: number;
  maxFiles: number;
};

/** "30 MB", "24.4 MB", "612 KB", "0 bytes" -- what a person reads on a file. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes >= MB) {
    const mb = bytes / MB;
    // One decimal, and never a trailing ".0" -- "30 MB", not "30.0 MB".
    const rounded = Math.round(mb * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** ".pdf" from "DEWA-permit.PDF"; "" when the name carries no extension. */
export function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match ? `.${match[1].toLowerCase()}` : "";
}

/** The accepted extensions as one readable list: ".dwg, .dxf, .pdf or .glb". */
export function acceptList(policy: AttachPolicy): string {
  const items = [...policy.accept];
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

export type CheckableFile = { name: string; size: number };

/**
 * Why this file cannot be attached, in the words the chip will show -- or
 * null when it can.
 *
 * ORDER MATTERS AND IS DELIBERATE: the count first (nothing else is worth
 * saying once the tray is full), then the type, then the size. A .docx of
 * 40 MB is the wrong kind of file; telling the user to shrink it would send
 * them off to do something that cannot help.
 */
export function checkFile(
  file: CheckableFile,
  policy: AttachPolicy,
  alreadyAttached = 0
): string | null {
  if (alreadyAttached >= policy.maxFiles) {
    return `Too many files: ${alreadyAttached} attached, limit ${policy.maxFiles}`;
  }
  const ext = extensionOf(file.name);
  if (policy.accept.length > 0 && !policy.accept.includes(ext)) {
    return ext
      ? `Wrong type: ${ext} — attach ${policy.acceptWords}`
      : `Wrong type: no file extension — attach ${policy.acceptWords}`;
  }
  if (file.size > policy.maxBytes) {
    // C-07, verbatim: "Too large: 24 MB, limit 20 MB".
    return `Too large: ${formatSize(file.size)}, limit ${formatSize(policy.maxBytes)}`;
  }
  return null;
}

/**
 * The whole batch, checked in one pass, with the running count carried so the
 * fourth file of a three-file limit is refused rather than the first.
 */
export function checkBatch(
  files: readonly CheckableFile[],
  policy: AttachPolicy,
  alreadyAttached = 0
): { file: CheckableFile; error: string | null }[] {
  let accepted = alreadyAttached;
  return files.map((file) => {
    const error = checkFile(file, policy, accepted);
    if (!error) accepted += 1;
    return { file, error };
  });
}

// ---------------------------------------------------------------------------
// WHAT THE IMPORTER SAID
// ---------------------------------------------------------------------------

/** The shape VERIDIAN's already-shipped BOQ importer answers with. */
export type BoqImportSummary = { totalRows?: number; importedLineItems?: number; warnings?: string[] };

/**
 * C-07: the reply card "shows the importer's row count and per-row errors".
 *
 * It never rounds a partial import up to a clean success: 40 of 45 says 40 of
 * 45, because the five rows that did not land are the whole reason a person
 * reads this line.
 */
export function importSummaryLine(summary: BoqImportSummary | null | undefined): string {
  const imported = Number(summary?.importedLineItems ?? 0);
  const total = Number(summary?.totalRows ?? 0);
  if (!total) return `Imported ${imported} line${imported === 1 ? "" : "s"}`;
  if (imported === total) return `Imported all ${total} row${total === 1 ? "" : "s"}`;
  return `Imported ${imported} of ${total} rows`;
}

/** The per-row problems, capped so the card stays a card. */
export function importWarnings(summary: BoqImportSummary | null | undefined, limit = 5): string[] {
  const warnings = Array.isArray(summary?.warnings) ? summary!.warnings : [];
  if (warnings.length <= limit) return warnings;
  return [...warnings.slice(0, limit), `…and ${warnings.length - limit} more`];
}
