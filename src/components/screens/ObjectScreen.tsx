"use client";

// R67 D-67 -- ONE object page for every module.
//
// R-257: "ObjectScreen (display-first with the word actions Edit | Delete |
// Back, Delete separated from Edit, footer message slot, autosave slot)."
//
// Four decisions this makes once, so twenty object pages cannot each make
// them differently:
//
//  1. DISPLAY FIRST. The page opens showing what the record IS. An object
//     page that opens as an edit form makes reading a record cost a decision
//     about whether you are about to change it.
//  2. DELETE IS SEPARATED FROM EDIT. Not adjacent, not the same size, not
//     the same tone. Delete sits after a gap, in the muted word style, and
//     it never fires on its own click.
//  3. THE CONFIRM IS INLINE AND NAMES THE BLAST RADIUS. "Delete permit
//     BP-2026-0142 and its PDF? This cannot be undone." -- not "Are you
//     sure?", and not a modal: PROJEXA's one remaining popup was removed by
//     D-01 and this is not the place to add a new one.
//  4. THE FOOTER MESSAGE IS PERSISTENT. "Created permit BP-2026-0142" has to
//     survive being read. A toast that fades is how a user ends up unsure
//     whether the save happened.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectBreadcrumb } from "@/components/ProjectBreadcrumb";

export type ObjectFacet = { label: string; value: React.ReactNode };

export type ObjectScreenProps = {
  module: string;
  moduleHref: string;
  /** "Permit", "BOQ", "Progress entry". */
  objectLabel: string;
  /** The record's own name, as the <h1>. */
  title: string;
  /** Small context pairs under the title -- "Project: Cedar Heights Villa". */
  facets?: ObjectFacet[];
  onEdit?: () => void;
  /** Omit entirely where the module has no delete path -- never a dead control. */
  onDelete?: {
    /** The whole sentence, from deleteConfirmation(). */
    confirmation: string;
    run: () => void | Promise<void>;
    /** Why the control is unavailable. Renders it disabled with the reason. */
    disabledReason?: string;
  };
  /** A persistent line under the actions: "Created permit BP-2026-0142". */
  footerMessage?: React.ReactNode;
  /** "Saving… / Saved 12:04" for screens that autosave. */
  autosave?: React.ReactNode;
  /** A failure raised by an action on this page. */
  error?: string | null;
  children: React.ReactNode;
};

export function ObjectScreen({
  module,
  moduleHref,
  objectLabel,
  title,
  facets = [],
  onEdit,
  onDelete,
  footerMessage,
  autosave,
  error,
  children,
}: ObjectScreenProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="flex-1 space-y-4 p-6">
      <ProjectBreadcrumb module={module} moduleHref={moduleHref} trail={[title]} backHref={moduleHref} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl text-ct-navy">{title}</h1>
          {facets.length > 0 && (
            <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-px-muted">
              {facets.map((f) => (
                <div key={f.label} className="flex gap-1">
                  <dt>{f.label}:</dt>
                  <dd className="text-ct-navy">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* Word actions, in R-257's order, with Delete pushed away from Edit
            by a real gap rather than sitting next to it in the same tone. */}
        <div className="flex items-center gap-2">
          {autosave && <span className="mr-2 text-[12px] text-px-muted">{autosave}</span>}
          {onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => router.push(moduleHref)}>
            Back
          </Button>
          {onDelete && (
            <span className="ml-6 inline-flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-px-error"
                disabled={Boolean(onDelete.disabledReason) || deleting}
                title={onDelete.disabledReason}
                onClick={() => setConfirming(true)}
              >
                Delete
              </Button>
              {onDelete.disabledReason && <span className="text-xs text-px-muted">{onDelete.disabledReason}</span>}
            </span>
          )}
        </div>
      </div>

      {confirming && onDelete && (
        <div
          role="alertdialog"
          aria-label="Confirm delete"
          className="rounded-lg border border-px-error-border bg-px-error-light p-4 text-sm"
        >
          <p className="flex items-start gap-2 text-px-error">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {onDelete.confirmation}
          </p>
          <div className="mt-3 flex items-center gap-2 pl-6">
            <Button
              size="sm"
              variant="outline"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await onDelete.run();
                } finally {
                  setDeleting(false);
                  setConfirming(false);
                }
              }}
            >
              {deleting ? "Deleting…" : `Delete ${objectLabel.toLowerCase()}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-px-error-border bg-px-error-light p-3 text-sm text-px-error">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-6">{children}</CardContent>
      </Card>

      {/* The receipt. Persistent, not a toast -- it is the only proof on
          screen that the save the user just made actually landed. */}
      {footerMessage && (
        <div role="status" className="rounded-md border border-px-border bg-white px-3 py-2 text-[12px] text-px-muted">
          {footerMessage}
        </div>
      )}
    </div>
  );
}

export default ObjectScreen;
