"use client";

// R67 D-06 (audit R-015/R-020). This was a floating Card in the middle of the
// right pane: no breadcrumb, no Back, no statement of which project the permit
// would land on, a "Cancel" that meant Back, and a required-field counter that
// named fields in a different vocabulary from the list and the object page.
// It is now the same framed create screen the object page uses, so a permit
// looks like a permit everywhere in the module.
//
// The multipart POST /api/permits is UNCHANGED (Wave 143). The M29 draft
// machinery is still deliberately not used here -- a required file upload does
// not fit the generic JSON screen_drafts payload; see permits/new/page.tsx.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setScreenMessage } from "@/lib/screen-message";

/** The permit PDF limit, stated to the user and enforced before the upload. */
export const MAX_PDF_MB = 10;

/**
 * The required fields still missing, in FIELD ORDER, in the module's one word
 * set (lower-cased for use inside a sentence). Field order matters: a counter
 * that lists them in a different order from the form makes the user hunt.
 */
export function missingPermitFields(input: {
  name: string;
  issueDate: string;
  endDate: string;
  hasFile: boolean;
}): string[] {
  return [
    ...(input.name.trim() ? [] : ["permit name"]),
    ...(input.issueDate ? [] : ["issue date"]),
    ...(input.endDate ? [] : ["end date"]),
    ...(input.hasFile ? [] : ["permit PDF"]),
  ];
}

/** "4 required fields still needed - permit name, issue date, end date, permit PDF" */
export function missingPermitFieldsReason(missing: string[]): string | undefined {
  if (missing.length === 0) return undefined;
  return `${missing.length} required field${missing.length === 1 ? "" : "s"} still needed - ${missing.join(", ")}`;
}

/**
 * Both dates are ISO yyyy-mm-dd strings from <input type="date">, so a lexical
 * compare is a correct chronological compare -- no Date parsing, no timezone.
 */
export function endDateError(issueDate: string, endDate: string): string | undefined {
  if (!issueDate || !endDate) return undefined;
  return endDate < issueDate ? "End date must be on or after the issue date" : undefined;
}

/** "10.4 MB" rather than "10 MB" when rounding would make the message read
 *  "This file is 10 MB; the limit is 10 MB". */
export function describeFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const rounded = Math.round(mb);
  return `${rounded === MAX_PDF_MB ? mb.toFixed(1) : String(rounded)} MB`;
}

export function fileSizeError(bytes: number | null): string | undefined {
  if (bytes === null) return undefined;
  return bytes > MAX_PDF_MB * 1024 * 1024
    ? `This file is ${describeFileSize(bytes)}; the limit is ${MAX_PDF_MB} MB`
    : undefined;
}

function attentionReason(count: number): string | undefined {
  if (count === 0) return undefined;
  return `${count} field${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention`;
}

export default function PermitCreateClient({ projectId, projectName }: { projectId: string; projectName?: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<FieldMessage[]>([]);

  const [name, setName] = useState("");
  const [permitNumber, setPermitNumber] = useState("");
  const [permitAuthority, setPermitAuthority] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // Validation is shown on blur (and on choose, for the file) rather than on
  // every keystroke -- a message that appears while a user is still typing the
  // first character of a date is noise, not help.
  const [touchedDates, setTouchedDates] = useState(false);

  const missing = missingPermitFields({ name, issueDate, endDate, hasFile: file !== null });
  const dateError = touchedDates ? endDateError(issueDate, endDate) : undefined;
  const sizeError = fileSizeError(file ? file.size : null);
  const attentionCount = (dateError ? 1 : 0) + (sizeError ? 1 : 0);
  // Attention wins over the counter: a field that is filled but wrong is a
  // more specific thing to say than "still needed".
  const disabledReason = saving
    ? "Saving…"
    : attentionReason(attentionCount) ?? missingPermitFieldsReason(missing);
  const saveDisabled = saving || missing.length > 0 || attentionCount > 0;

  async function createPermit() {
    if (saveDisabled) return;
    setSaving(true);
    setMessages([]);
    // Same multipart contract the dialog and the previous full-page form used.
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("name", name);
    if (permitNumber.trim()) formData.set("permitNumber", permitNumber.trim());
    if (permitAuthority.trim()) formData.set("permitAuthority", permitAuthority.trim());
    formData.set("issueDate", issueDate);
    formData.set("endDate", endDate);
    if (file) formData.set("file", file);
    try {
      const res = await fetch("/api/permits", { method: "POST", body: formData });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessages([{ level: "error", text: (body && body.error) || `Couldn't create this permit (HTTP ${res.status})` }]);
        setSaving(false);
        return;
      }
      // Carried through the frame's message area on the object page, not a
      // toast that is gone before the page finishes painting.
      setScreenMessage("permits.object", {
        level: "success",
        text: `Permit ${permitNumber.trim() || name.trim()} created`,
      });
      router.push(`/permits/${body.id}`);
    } catch (err) {
      setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't create this permit" }]);
      setSaving(false);
    }
  }

  const backToList = () => router.push(`/permits?projectId=${projectId}`);

  return (
    <ObjectScreen
      breadcrumb="Permits / New Permit"
      title="New Permit"
      // Says where this permit will land BEFORE the user fills anything in.
      subtitle={projectName ? `For project: ${projectName}` : undefined}
      mode="create"
      hasDraft={false}
      onSave={createPermit}
      // "Cancel" meant Back on a screen with nothing to cancel yet.
      onCancel={backToList}
      onBack={backToList}
      saveDisabled={saveDisabled}
      // Deliberately NOT passed to ObjectScreen: it appends the reason INSIDE
      // the button ("Save (4 required fields still needed - ...)"), and
      // correction C-15's rule is that a sentence never sits inside a button
      // again. The same words are rendered beside the button instead, below.
      messages={messages}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="name">Permit name</Label>
          {/* autoFocus: the first field of a create screen the user navigated
              to on purpose -- there is nothing else on this screen to read
              first, so focus is not stolen from anything. */}
          <Input id="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Building Permit - Villa 21" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="permitNumber">Permit number (optional)</Label>
          <Input id="permitNumber" value={permitNumber} onChange={(e) => setPermitNumber(e.target.value)} placeholder="e.g. BP-2026-0142" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="permitAuthority">Issuing authority (optional)</Label>
          <Input id="permitAuthority" value={permitAuthority} onChange={(e) => setPermitAuthority(e.target.value)} placeholder="e.g. Dubai Municipality" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="issueDate">Issue date</Label>
          <Input id="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} onBlur={() => setTouchedDates(true)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} onBlur={() => setTouchedDates(true)} />
          {dateError && (
            <p role="alert" className="text-[12.5px] text-[color:var(--color-veri-status-late)]">{dateError}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="file">Permit PDF</Label>
          <Input
            id="file"
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files && e.target.files.length > 0 ? e.target.files[0] : null)}
          />
          <p className="text-[12.5px] text-ct-muted">PDF only, up to {MAX_PDF_MB} MB</p>
          {sizeError && (
            <p role="alert" className="text-[12.5px] text-[color:var(--color-veri-status-late)]">{sizeError}</p>
          )}
        </div>
        {/* The reason the primary action is disabled, beside it rather than
            inside it, counting down as the form fills. */}
        {disabledReason && (
          <p role="status" className="pt-1 text-[12.5px] text-ct-muted">{disabledReason}</p>
        )}
      </div>
    </ObjectScreen>
  );
}
