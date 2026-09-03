// R67 D-14 (audit R-039/R-044). Everything the New Document screen has to
// decide BEFORE the user types anything, kept as pure functions so the create
// screen, the list's filter bar and their tests all agree on one answer.
//
// The defect this closes: the upload form defaulted Category to "other" and
// linkedEntityType to the literal string "project", so a site engineer who
// dropped DEWA_permit_2026.pdf and pressed Save filed a permit as "other",
// related to nothing. Neither field was wrong-by-accident -- the form simply
// never looked at the file it had been handed.
//
// Deliberately NOT "use client": these are pure functions over strings, and the
// 25 MB cap is a fact a server component should be able to state too.

import { fileExtension, fileSizeError } from "@/lib/file-limits";

/** The bucket's own file_size_limit, and compliance-tracker's MAX_SIZE_BYTES. */
export const DOCUMENT_MAX_MB = 25;

/**
 * What the picker offers. `image/*` rather than an extension list because a
 * phone camera roll is the common source and its file extensions vary by
 * device; the rest are the formats this module is actually used for.
 */
export const DOCUMENT_ACCEPT = ".pdf,image/*,.eml,.msg,.docx,.xlsx";

/**
 * R67 D-14 adds "email": correspondence is one of the two things a site office
 * files most (the other is permits), and filing it as "other" is why the
 * category column was useless. The same list is used by the list filter, the
 * create screen and the object page, so the three cannot drift.
 */
export const DOCUMENT_CATEGORIES = [
  "permit",
  "drawing",
  "contract",
  "certificate",
  "license",
  "site_photo",
  "email",
  "other",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

const LAST_CATEGORY_KEY = "documents.lastCategory";

/** "DEWA_permit_2026.pdf" -> "DEWA_permit_2026". A name, not a file name. */
export function fileStem(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? fileName : fileName.slice(0, dot);
}

/** "1.2 MB" / "240 KB" -- the size shown under the drop zone. */
export function describeFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "This file is 31 MB; the limit is 25 MB", or undefined when it fits. */
export function documentSizeError(bytes: number | null): string | undefined {
  return fileSizeError(bytes, DOCUMENT_MAX_MB);
}

/**
 * R67 D-78. The extensions this module actually takes, spelled out.
 *
 * DOCUMENT_ACCEPT above carries `image/*`, which is right for the picker (a
 * phone camera roll's extensions vary by device) and useless as a check, so the
 * image half is handled by its own rule below rather than by listing every
 * format a camera might produce.
 */
export const DOCUMENT_EXTENSIONS = [".pdf", ".eml", ".msg", ".docx", ".xlsx"] as const;

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif", ".bmp", ".tif", ".tiff"] as const;

/**
 * "Choose a PDF, image, email or Office file — this is a .zip", or undefined
 * when the file is one of those.
 *
 * The drop zone is why this exists: `accept` filters the PICKER and nothing
 * else, and a file dragged onto the zone never passes through a picker at all.
 * Before this, a .zip was uploaded and came back as VERIDIAN's flat "Failed to
 * upload document".
 */
export function documentTypeError(fileName: string | null): string | undefined {
  if (!fileName) return undefined;
  const ext = fileExtension(fileName);
  const allowed: readonly string[] = [...DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS];
  if (allowed.includes(ext)) return undefined;
  const wanted = "Choose a PDF, image, email or Office file";
  return ext ? `${wanted} — this is a ${ext}` : wanted;
}

/**
 * What the file itself says it is. Two signals only, both of them things a
 * person would agree with on sight: an email file is an email, and a file with
 * "permit" in its name is a permit. Anything less certain than that is left to
 * the user rather than guessed at -- a wrongly auto-filed document is worse
 * than an unfiled one, because nobody goes back to check a field that was
 * already filled in.
 */
export function inferCategory(fileName: string): DocumentCategory | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".eml") || lower.endsWith(".msg")) return "email";
  if (lower.includes("permit")) return "permit";
  return null;
}

/**
 * The category the form opens on once a file is chosen: what this user filed
 * last (they are usually filing a batch of the same thing), else what the file
 * itself says, else "other".
 */
export function defaultCategory(fileName: string, remembered: string | null): DocumentCategory {
  if (remembered && (DOCUMENT_CATEGORIES as readonly string[]).includes(remembered)) {
    return remembered as DocumentCategory;
  }
  return inferCategory(fileName) ?? "other";
}

/** localStorage throws outright in some privacy modes; a remembered convenience must never take the screen down. */
export function readLastCategory(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_CATEGORY_KEY);
  } catch {
    return null;
  }
}

export function writeLastCategory(category: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CATEGORY_KEY, category);
  } catch {
    // Not remembering the last category costs one dropdown choice next time.
  }
}

export type EmailHeaders = { from: string; receivedOn: string; subject: string };

/**
 * The three fields an .eml can answer for itself, read from its header block.
 * RFC 5322 headers end at the first blank line, and a header value may be
 * FOLDED across continuation lines that begin with a space or a tab -- a long
 * Subject: almost always is, so a parser that reads only the first line of each
 * header truncates most real subjects.
 *
 * Best-effort by design: an unparseable file leaves every field empty and the
 * user types what they know. It never guesses.
 */
export function parseEmailHeaders(source: string): EmailHeaders {
  const headerBlock = source.replace(/\r\n/g, "\n").split("\n\n")[0] ?? "";
  const unfolded: string[] = [];
  for (const line of headerBlock.split("\n")) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }

  const read = (name: string): string => {
    const match = unfolded.find((line) => line.toLowerCase().startsWith(`${name}:`));
    return match ? match.slice(name.length + 1).trim() : "";
  };

  return {
    from: read("from"),
    receivedOn: toDateInputValue(read("date")),
    subject: read("subject"),
  };
}

/**
 * An RFC 5322 Date: header into the yyyy-mm-dd a date input takes, or "" when
 * it cannot be read. UTC on purpose: same rule as format-date.ts -- a date-only
 * value must not shift a calendar day with the reader's time zone.
 */
export function toDateInputValue(raw: string): string {
  if (!raw.trim()) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

/**
 * What "Relates to" offers. The project itself is first and is the default, so
 * the screen's existing behaviour (every document filed against the project) is
 * what an untouched form still does.
 */
export const RELATES_TO_TYPES = ["project", "permit", "rfi", "mom"] as const;
export type RelatesToType = (typeof RELATES_TO_TYPES)[number];

const RELATES_TO_WORDS: Record<RelatesToType, string> = {
  project: "Project",
  permit: "Permit",
  rfi: "RFI",
  mom: "Minutes of Meeting",
};

/** "RFI" -- never the wire value "rfi", and never a blank for an unknown type. */
export function relatesToWord(type: string | null | undefined): string {
  if (!type) return "—";
  return RELATES_TO_WORDS[type as RelatesToType] ?? type.replace(/_/g, " ");
}
