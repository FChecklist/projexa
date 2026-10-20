// R-C14 (Upload site instruction form). The pure rules of the new-site-instruction screen, kept out of the component so they can be
// tested without a DOM. The field set is the one the server's createSiteInstruction takes (project, issue date, to-contractor,
// description, optional drawing reference, cost/time impact, optional linked BOQ) plus an optional PDF or photo.
// The form shape is the industry-standard Architect/Site Instruction record, not a format Sumeet supplied.

export const SI_MAX_FILE_MB = 10;
export const SI_FILE_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg"] as const;

/** Required fields still empty, in the form's field order, lower-cased for use inside a sentence. */
export function missingSiteInstructionFields(input: { issueDate: string; toContractor: string; description: string }): string[] {
  return [
    ...(input.issueDate ? [] : ["issue date"]),
    ...(input.toContractor.trim() ? [] : ["to contractor"]),
    ...(input.description.trim() ? [] : ["instruction"]),
  ];
}

/** "2 required fields still needed - to contractor, instruction" */
export function missingSiteInstructionReason(missing: string[]): string | undefined {
  if (missing.length === 0) return undefined;
  return `${missing.length} required field${missing.length === 1 ? "" : "s"} still needed - ${missing.join(", ")}`;
}

/** The attached file, when there is one, must be a PDF or a photo and within the size limit. */
export function siteInstructionFileError(file: { name: string; size: number } | null): string | undefined {
  if (!file) return undefined;
  const lower = file.name.toLowerCase();
  if (!SI_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "The file must be a PDF or a photo (.pdf, .png, .jpg)";
  if (file.size > SI_MAX_FILE_MB * 1024 * 1024) return `This file is over the ${SI_MAX_FILE_MB} MB limit`;
  return undefined;
}

/** The SI number as people write it. A missing number (not yet issued) is an en dash. */
export function siLabel(siNumber: number | null | undefined): string {
  return typeof siNumber === "number" ? `SI-${siNumber}` : "–";
}

/**
 * What the create screen does with the server's answer: the id of the new instruction (where Save lands) and the receipt text.
 * A 207 from the route carries `attachmentError` -- the record landed, the file did not -- which is a warning, never a clean success.
 * No id means the server did not confirm a saved record, which is a failure and throws.
 */
export function readCreatedSiteInstruction(body: {
  siteInstruction?: { id?: string; siNumber?: number };
  attachmentError?: string;
  /** Set when the save timed out and the record was then FOUND by re-reading the list (see recover-created.ts). */
  recovered?: boolean;
  /** With `recovered`: a file was chosen, and whether it was attached is not known from the list. */
  fileExpected?: boolean;
} | null | undefined): { id: string; level: "success" | "warning"; text: string } {
  const created = body?.siteInstruction;
  const id = typeof created?.id === "string" ? created.id : "";
  if (!id) throw new Error("The server did not confirm a saved site instruction");
  const label = siLabel(created?.siNumber);
  if (body?.recovered) {
    return body.fileExpected
      ? { id, level: "warning", text: `Site instruction ${label} created. The server was slow, so open it and check the file is attached.` }
      : { id, level: "success", text: `Site instruction ${label} created` };
  }
  return body?.attachmentError
    ? { id, level: "warning", text: `Site instruction ${label} created, but the file was not attached: ${body.attachmentError}` }
    : { id, level: "success", text: `Site instruction ${label} created` };
}
