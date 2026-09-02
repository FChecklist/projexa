"use client";

// R67 D-11, FORKED from @fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx
// per programme decision D-09 (no kit release in this programme: a kit
// behaviour change is forked into projexa, and everything not forked keeps
// importing the kit -- ScreenFrame, StatusBadge, DocumentFlow and the shared
// types below all still come from the kit package). The kit copy is UNCHANGED
// and is still what every other object screen in this app renders; editing
// node_modules is erased by CI's frozen-lockfile install.
//
// THE DIFFERENCES FROM THE KIT, both of them small and both listed here so a
// future reader can diff this against the kit source and find nothing else.
//
// 1. `deleteLabel`. The kit hard-codes the destructive control's word as "Delete",
// which is right for a permit (D-05) and wrong for a drawing: R67 D-11 gives
// the drawings object page TWO different destructive acts with different
// meanings and different gates -- "Remove" (a hard delete inside the 24-hour
// grace window, the file goes too) and "Dispose" (the records-management act,
// gated on the retention policy). A screen that called both of them "Delete"
// would be lying about one of them.
//
// 2. A facet's `value` is a ReactNode rather than a string (R67 D-12). The
// drawings object page's "Supersedes" facet has to LINK to the revision it
// replaced -- a facet that named the previous revision without going there
// would make the reader search the register by hand. Every existing caller is
// unaffected: a string is a ReactNode.
//
// Everything else -- layout, the draft lifecycle, the autosave timing, the
// spacer that keeps a destructive action away from the common ones -- is
// carried over verbatim.
//
// Original kit header follows.
//
// R42 seq21 (M28 OBJECT archetype + M29 draft lifecycle + M31 document
// model). Dynamic header, facets, dual header/item status, document flow,
// and the FULL draft lifecycle: Edit -> lock+draft -> autosave (debounced
// ~2s) -> Save (caller validates+writes+deletes draft) -> Cancel (confirm
// then discard) -> leave without saving (draft kept, editing icon shown).
//
// This component owns NO networking of its own -- every persistence step is
// a callback prop, so the identical component works against projexa's API
// routes, compliance-tracker's, or any future product's, per this kit's own
// reuse principle.
import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import {
  ScreenFrame,
  StatusBadge,
  DocumentFlow,
  type DocumentFlowData,
  type FieldMessage,
  type StatusTone,
} from "@fchecklist/veridian-ui-kit/screens";

const AUTOSAVE_DEBOUNCE_MS = 2000; // GLOBAL: "autosave debounced ~2s"

export type ObjectScreenMode = "display" | "edit" | "create";

export type ObjectScreenProps = {
  breadcrumb: React.ReactNode;
  title: string; // "New <Object>" until named, per M29 -- caller supplies this already resolved
  subtitle?: string;
  headerStatus?: { tone: StatusTone; label: string }; // dual header/item status -- this is the HEADER half (M31)
  facets?: { label: string; value: React.ReactNode }[];
  documentFlow?: DocumentFlowData;
  mode: ObjectScreenMode;
  hasDraft: boolean; // an existing draft the user left mid-edit (editing icon, M29)
  lockedByOther?: { userId: string; lockExpiresAt: string } | null;
  onEdit?: () => void | Promise<void>;
  onSave?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onBack?: () => void;
  /** The verb this screen's destructive action actually performs. Defaults to the kit's "Delete". */
  deleteLabel?: string;
  deleteDisabledReason?: string;
  saveDisabled?: boolean;
  saveDisabledReason?: string; // e.g. "2 required fields"
  onAutosave?: () => void | Promise<void>; // caller reads its own current form state; ObjectScreen only owns the timing
  messages: FieldMessage[];
  onMessageClick?: (message: FieldMessage) => void;
  children: React.ReactNode; // FormSection(s) / read-only field display, anchor-section content
};

export function ObjectScreen({
  breadcrumb,
  title,
  subtitle,
  headerStatus,
  facets,
  documentFlow,
  mode,
  hasDraft,
  lockedByOther,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onBack,
  deleteLabel = "Delete",
  deleteDisabledReason,
  saveDisabled,
  saveDisabledReason,
  onAutosave,
  messages,
  onMessageClick,
  children,
}: ObjectScreenProps) {
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced autosave -- fires AUTOSAVE_DEBOUNCE_MS after the LAST call to
  // scheduleAutosave() while in edit/create mode. Exposed via a data
  // attribute hook so the caller's field onChange can trigger it without
  // ObjectScreen needing to know the field shape.
  function scheduleAutosave() {
    if (!onAutosave) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void onAutosave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }
  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
  }, []);

  const isEditing = mode === "edit" || mode === "create";

  const footerActions: React.ReactNode = isEditing ? (
    <>
      <button
        type="button"
        onClick={() => onSave?.()}
        disabled={saveDisabled}
        title={saveDisabled ? saveDisabledReason : undefined}
        className="rounded-md bg-ct-teal px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Save{saveDisabled && saveDisabledReason ? ` (${saveDisabledReason})` : ""}
      </button>
      <button type="button" onClick={() => onCancel?.()} className="rounded-md border border-ct-border2 px-3 py-1.5 text-[13px] text-ct-navy">
        Cancel
      </button>
    </>
  ) : (
    <>
      {onEdit && (
        <button type="button" onClick={() => onEdit()} className="rounded-md bg-ct-navy px-3 py-1.5 text-[13px] font-medium text-white">
          Edit
        </button>
      )}
      {/* Destructive actions are never adjacent to common ones (GLOBAL) -- a spacer, not just a gap class, keeps Delete visually separated. */}
      {onDelete && <div className="flex-1" />}
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete()}
          disabled={!!deleteDisabledReason}
          title={deleteDisabledReason}
          className="rounded-md border border-[color:var(--color-veri-status-late)] px-3 py-1.5 text-[13px] text-[color:var(--color-veri-status-late)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {deleteLabel}
        </button>
      )}
    </>
  );

  const headerMessageStrip = lockedByOther
    ? `Locked by another user until ${new Date(lockedByOther.lockExpiresAt).toLocaleTimeString()}`
    : undefined;

  return (
    <ScreenFrame
      breadcrumb={
        <span className="flex items-center gap-2">
          {onBack && (
            <button type="button" onClick={onBack} className="text-ct-muted hover:text-ct-navy">
              ← Back
            </button>
          )}
          {breadcrumb}
        </span>
      }
      headerMessageStrip={headerMessageStrip}
      footerActions={footerActions}
      messages={messages}
      onMessageClick={onMessageClick}
    >
      <div data-veri-autosave-trigger onChangeCapture={isEditing ? scheduleAutosave : undefined}>
        <div className="px-4 py-3 border-b border-ct-border">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-heading text-xl text-ct-navy flex items-center gap-2">
                {title}
                {hasDraft && !isEditing && <Pencil className="size-3.5 text-ct-muted" aria-label="Draft in progress" />}
              </h1>
              {subtitle && <p className="text-[13px] text-ct-muted mt-0.5">{subtitle}</p>}
            </div>
            {headerStatus && <StatusBadge tone={headerStatus.tone} label={headerStatus.label} />}
          </div>
          {facets && facets.length > 0 && (
            <dl className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
              {facets.map((f) => (
                <div key={f.label} className="text-[12.5px]">
                  <dt className="text-ct-muted inline">{f.label}: </dt>
                  <dd className="text-ct-navy inline font-medium">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {children}

        {documentFlow && <DocumentFlow data={documentFlow} />}
      </div>
    </ScreenFrame>
  );
}
