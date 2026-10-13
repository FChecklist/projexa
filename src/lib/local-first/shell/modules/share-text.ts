// LOCAL-FIRST shell: the text a person pastes into WhatsApp, made ON THE LAPTOP with no network (Sumeet R-C04 minutes, R-C15 reports; checklist 3.4).
//
// WHY TEXT. A public link to a report or to minutes is made by the server (a signed, expiring link) and WhatsApp itself needs a connection, so neither can
// exist offline. What the laptop CAN do is put the report's own figures into a short message the person copies and pastes into WhatsApp when they have
// signal. The owner's ruling is that PROJEXA never uses the WhatsApp Business API: sharing is the person pasting (report-document-actions.ts whatsappHref).
//
// RULES. The text states what the laptop holds and nothing it works out: values are the server's, as it sent them to THIS person (a figure hidden for the
// role is not in the snapshot, so it is not in the message); numbers are printed as the screen prints them; a date is the house form dd-mm-yyyy; the message
// says which copy it is made from and when it was saved. It is kept short (a handful of fields and the first rows of each table), because a long message is
// not read: what is left out is said ("12 more rows are in the CSV").

import { formatDate, formatDateTime } from "@/lib/format-date";
import { humanizeKey } from "@/lib/report-run";

/** The most rows of one table, and fields of one block, that go into the message. */
export const MAX_TABLE_ROWS = 15;
export const MAX_FIELDS = 30;
/** WhatsApp takes far more; this keeps the message one a person will read. */
export const MAX_MESSAGE_CHARS = 5000;

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

/** A value as the report screen prints it: numbers with thousands separators (two decimals at most), dates in the house form, a dash for nothing. */
export function shareCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return ISO_DAY.test(v) && Number.isFinite(Date.parse(v)) ? (v.length > 10 ? formatDateTime(v) : formatDate(v)) : v.replace(/\s+/g, " ").trim();
  return Array.isArray(v) ? `${v.length} items` : "-";
}

function fieldLines(obj: Record<string, unknown>): string[] {
  const scalars = Object.entries(obj).filter(([, v]) => !Array.isArray(v) && !isPlain(v));
  const lines = scalars.slice(0, MAX_FIELDS).map(([k, v]) => `${humanizeKey(k)}: ${shareCell(v)}`);
  if (scalars.length > MAX_FIELDS) lines.push(`(${scalars.length - MAX_FIELDS} more fields are in the CSV)`);
  return lines;
}

function rowLines(rows: unknown[]): string[] {
  if (rows.length === 0) return ["No rows."];
  const objects = rows.filter(isPlain);
  const lines =
    objects.length === 0
      ? rows.slice(0, MAX_TABLE_ROWS).map((r) => `- ${shareCell(r)}`)
      : objects.slice(0, MAX_TABLE_ROWS).map((r) => {
          const parts = Object.entries(r).filter(([, v]) => !Array.isArray(v) && !isPlain(v) && v !== null && v !== "").map(([k, v]) => `${humanizeKey(k)} ${shareCell(v)}`);
          return `- ${parts.join(", ")}`;
        });
  if (rows.length > MAX_TABLE_ROWS) lines.push(`(${rows.length - MAX_TABLE_ROWS} more rows are in the CSV)`);
  return lines;
}

/**
 * The message for one report run kept on this laptop. `savedAt` is when the laptop received the server's answer (ms since epoch).
 * The first line is the report and project in bold (WhatsApp's *bold*), the second says which copy it is.
 */
export function reportShareText(input: { title: string; projectName: string | null; savedAt: number; body: unknown }): string {
  const lines: string[] = [`*${input.title}${input.projectName ? ` - ${input.projectName}` : ""}*`, `Saved from PROJEXA on ${formatDateTime(input.savedAt)} (the last copy this laptop received)`];
  const body = input.body;
  if (Array.isArray(body)) {
    lines.push("", ...rowLines(body));
  } else if (isPlain(body)) {
    const fields = fieldLines(body);
    if (fields.length > 0) lines.push("", ...fields);
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) lines.push("", `*${humanizeKey(k)}*`, ...rowLines(v));
      else if (isPlain(v)) {
        const inner = fieldLines(v);
        if (inner.length > 0) lines.push("", `*${humanizeKey(k)}*`, ...inner);
      }
    }
  } else {
    lines.push("", shareCell(body));
  }
  return capMessage(lines);
}

function capMessage(lines: string[]): string {
  let text = lines.join("\n");
  if (text.length > MAX_MESSAGE_CHARS) text = `${text.slice(0, MAX_MESSAGE_CHARS - 80).replace(/\n[^\n]*$/, "")}\n\n(The rest is in the CSV.)`;
  return text;
}

/** The message for a meeting's minutes kept on this laptop (title, when, agenda, minutes). Attendee names and action items live on the server and are not in it. */
export function momShareText(input: { title: string; scheduledAt: string | null; status: string | null; agenda: readonly string[] | null; minutes: string | null }): string {
  const lines: string[] = [`*${input.title}*`];
  const when = input.scheduledAt && Number.isFinite(Date.parse(input.scheduledAt)) ? formatDateTime(input.scheduledAt) : null;
  lines.push(`Minutes of meeting${when ? `, ${when}` : ""}${input.status ? ` (${input.status})` : ""}`);
  if (input.agenda && input.agenda.length > 0) lines.push("", "*Agenda*", ...input.agenda.map((a, i) => `${i + 1}. ${a}`));
  lines.push("", "*Minutes*", input.minutes && input.minutes.trim() ? input.minutes.trim() : "No minutes recorded yet.");
  return capMessage(lines);
}

/** Copies text with no network: the clipboard API where the browser gives it, else the old select-and-copy. Returns whether it worked. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the older way
  }
  try {
    if (typeof document === "undefined") return false;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
