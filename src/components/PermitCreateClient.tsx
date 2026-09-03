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
import { useSubmit } from "@/lib/use-submit";
import {
  STORAGE_UNAVAILABLE_BANNER,
  STORAGE_UNAVAILABLE_REASON,
  describeFileSize as describeSize,
  fileSizeError as sizeError,
  fileTypeError,
} from "@/lib/file-limits";

/** The permit PDF limit, stated to the user and enforced before the upload. */
export const MAX_PDF_MB = 10;

/**
 * R67 D-78. The field says "Permit PDF" and its picker is filtered to
 * application/pdf, but a picker filter is not a guarantee -- every OS file
 * dialog lets a user switch it off. Nothing checked, so a .docx reached the
 * upload and came back as VERIDIAN's flat "Failed to upload file". The user was
 * told the permit did not save; they were not told which of the things they did
 * was the problem.
 */
export const PERMIT_EXTENSIONS = [".pdf"] as const;

export function permitFileTypeError(fileName: string | null): string | undefined {
  return fileTypeError(fileName, PERMIT_EXTENSIONS);
}

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

// R67 D-09: these two rules now live in src/lib/file-limits.ts, because the
// drawings form needs exactly the same wording with a different limit and a
// second copy with a new number in it is how two screens start disagreeing
// about what "too big" sounds like. The exported names and signatures here are
// unchanged -- this file's own call sites and tests never had to know.
/** "10.4 MB" rather than "10 MB" when rounding would make the message read
 *  "This file is 10 MB; the limit is 10 MB". */
export function describeFileSize(bytes: number): string {
  return describeSize(bytes, MAX_PDF_MB);
}

export function fileSizeError(bytes: number | null): string | undefined {
  return sizeError(bytes, MAX_PDF_MB);
}

function attentionReason(count: number): string | undefined {
  if (count === 0) return undefined;
  return `${count} field${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention`;
}

export default function PermitCreateClient({
  projectId,
  projectName,
  storageConfigured = true,
}: {
  projectId: string;
  projectName?: string;
  /** R67 D-78: from VERIDIAN's own storage probe, resolved server-side. Defaults to true. */
  storageConfigured?: boolean;
}) {
  const router = useRouter();
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

  // R67 D-72 (lane D0, folded in). This screen's own handler called fetch()
  // with NO signal at all, so a hung upstream left Save spinning forever, and a
  // refusal and a request that never left the device arrived as one sentence.
  // The shared submit hook owns the 10 s ceiling and tells those two apart; the
  // FormData it posts, and this screen's own field validation, are unchanged.
  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Permit",
    buildRequest: () => {
      // Same multipart contract the dialog and the previous full-page form used.
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("name", name);
      if (permitNumber.trim()) formData.set("permitNumber", permitNumber.trim());
      if (permitAuthority.trim()) formData.set("permitAuthority", permitAuthority.trim());
      formData.set("issueDate", issueDate);
      formData.set("endDate", endDate);
      if (file) formData.set("file", file);
      return { input: "/api/permits", init: { method: "POST", body: formData } };
    },
    onSuccess: (data) => {
      const id = typeof data?.id === "string" ? data.id : "";
      if (!id) throw new Error("The server did not confirm a saved permit");
      // Carried through the frame's message area on the object page, not a
      // toast that is gone before the page finishes painting.
      setScreenMessage("permits.object", {
        level: "success",
        text: `Permit ${permitNumber.trim() || name.trim()} created`,
      });
      router.push(`/permits/${id}`);
    },
  });
  const saving = submit.saving;

  const missing = missingPermitFields({ name, issueDate, endDate, hasFile: file !== null });
  const dateError = touchedDates ? endDateError(issueDate, endDate) : undefined;
  const sizeError = fileSizeError(file ? file.size : null);
  // R67 D-78: checked the moment a file is chosen -- choosing IS the
  // interaction, so waiting for a blur that may never come would hide the
  // problem until Save. Type before size: a .docx is not "too big", it is the
  // wrong thing entirely.
  const typeError = permitFileTypeError(file ? file.name : null);
  const fileError = typeError ?? sizeError;
  const attentionCount = (dateError ? 1 : 0) + (fileError ? 1 : 0);
  // Attention wins over the counter: a field that is filled but wrong is a
  // more specific thing to say than "still needed".
  const disabledReason = saving
    ? "Saving…"
    : attentionReason(attentionCount) ?? missingPermitFieldsReason(missing);
  const saveDisabled = saving || missing.length > 0 || attentionCount > 0 || !storageConfigured;

  function createPermit() {
    // R67 D-72: never a silent return. Save is already disabled with a reason,
    // but a guard that swallows a click is the fault this rule exists to kill.
    if (saveDisabled) {
      if (disabledReason) setMessages([{ level: "error", text: disabledReason }]);
      return;
    }
    setMessages([]);
    submit.submit();
  }

  // The hook's own failure, in this screen's message band -- one place for
  // every sentence, whether it came from a field rule or from the server.
  const bandMessages: FieldMessage[] = submit.failure
    ? [...messages, { level: "error" as const, text: submit.failure.message }]
    : messages;

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
      // The FIELD counter is deliberately NOT passed to ObjectScreen: it appends
      // the reason INSIDE the button ("Save (4 required fields still needed -
      // ...)"), and correction C-15's rule is that a sentence never sits inside
      // a button again. Those words are rendered beside the button instead.
      //
      // R67 D-78's storage reason IS passed, because it is four words, not a
      // sentence, and because it is a fact about the server rather than about
      // this form -- a user scanning for why Save is dead should find it on the
      // control itself.
      saveDisabledReason={!storageConfigured ? STORAGE_UNAVAILABLE_REASON : undefined}
      messages={bandMessages}
    >
      <div className="space-y-3 px-4 py-3">
        {!storageConfigured && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--color-veri-status-late)] bg-[color:var(--color-veri-status-late)]/5 p-3 text-[13px]"
          >
            {STORAGE_UNAVAILABLE_BANNER}
          </p>
        )}
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
          {fileError && (
            <p role="alert" className="text-[12.5px] text-[color:var(--color-veri-status-late)]">{fileError}</p>
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
