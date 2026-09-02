"use client";

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
//
// ─── PROJEXA FORK, R67 (programme decision D-09) ────────────────────────────
// This file is a COPY of @fchecklist/veridian-ui-kit/src/screens/
// ObjectScreen.tsx, taken at kit version 0.7.0 (the commit projexa's
// package.json pins). It is forked, not patched, because the kit's source is
// not on this machine and is not published -- editing node_modules is erased
// by CI's `bun install --frozen-lockfile`, and a kit release is out of scope
// for this programme. Everything else this screen needs (ScreenFrame,
// StatusBadge, DocumentFlow, the shared types) is still imported FROM the
// kit, so only this one component diverges.
//
// The divergence is exactly two additions, both required by R67 D-33:
//
//   deleteLabel   The kit hard-codes the word "Delete" on the destructive
//                 footer action. On a worker that word is a lie: the action
//                 sets isActive=false and keeps every attendance row and
//                 cost. A screen must be able to call it "Deactivate".
//   secondaryAction  A display-mode action beside Edit -- D-33 needs
//                 "Reactivate" on an inactive worker, so deactivation stops
//                 being one-way in the UI.
//
// Anything else that needs to change here should change in the kit and come
// back through a release; keep this fork's diff from upstream this small.
import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { ScreenFrame, StatusBadge, DocumentFlow } from "@fchecklist/veridian-ui-kit/screens";
import type { DocumentFlowData, FieldMessage, StatusTone } from "@fchecklist/veridian-ui-kit/screens";

const AUTOSAVE_DEBOUNCE_MS = 2000; // GLOBAL: "autosave debounced ~2s"

export type ObjectScreenMode = "display" | "edit" | "create";

export type ObjectScreenProps = {
  breadcrumb: React.ReactNode;
  title: string; // "New <Object>" until named, per M29 -- caller supplies this already resolved
  subtitle?: string;
  headerStatus?: { tone: StatusTone; label: string }; // dual header/item status -- this is the HEADER half (M31)
  facets?: { label: string; value: string }[];
  documentFlow?: DocumentFlowData;
  mode: ObjectScreenMode;
  hasDraft: boolean; // an existing draft the user left mid-edit (editing icon, M29)
  lockedByOther?: { userId: string; lockExpiresAt: string } | null;
  onEdit?: () => void | Promise<void>;
  onSave?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onBack?: () => void;
  /** FORK: the word on the destructive footer action. Defaults to the kit's "Delete". */
  deleteLabel?: string;
  /** FORK: a display-mode action rendered beside Edit, e.g. "Reactivate". */
  secondaryAction?: { label: string; onClick: () => void | Promise<void>; disabledReason?: string };
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
  secondaryAction,
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
      {/* FORK: the secondary display-mode action (e.g. Reactivate). Sits with
          Edit, on the non-destructive side of the spacer. */}
      {secondaryAction && (
        <button
          type="button"
          onClick={() => secondaryAction.onClick()}
          disabled={!!secondaryAction.disabledReason}
          title={secondaryAction.disabledReason}
          className="rounded-md border border-ct-border2 px-3 py-1.5 text-[13px] text-ct-navy disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {secondaryAction.disabledReason ? `${secondaryAction.label} (${secondaryAction.disabledReason})` : secondaryAction.label}
        </button>
      )}
      {/* Destructive actions are never adjacent to common ones (GLOBAL) -- a spacer, not just a gap class, keeps it visually separated. */}
      {onDelete && <div className="flex-1" />}
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete()}
          disabled={!!deleteDisabledReason}
          title={deleteDisabledReason}
          className="rounded-md border border-[color:var(--color-veri-status-late)] px-3 py-1.5 text-[13px] text-[color:var(--color-veri-status-late)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {/* FORK: was the hard-coded word "Delete". */}
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
