"use client";

// R67 PROGRAMME DECISION D-09 — THIS IS A FORK, ON PURPOSE. See the sibling
// ScreenFrame.tsx's header for the full reasoning (the kit's source is not on
// this machine, node_modules edits are erased by CI, so the file is forked
// into projexa and the kit is still imported for everything unchanged --
// StatusBadge, DocumentFlow and the shared types all still come from it).
//
// Copied from @fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx (v0.7.0)
// with ONE addition, which item D-63 (rec R-203) needs:
//
//   `headerActions` -- this object's own actions, as words, in the order the
//   caller gives them. The kit puts Edit in the FOOTER, next to Delete; the
//   global object-screen rule R-203 states is that an object's actions belong
//   in its header, in a fixed order, so a reader learns one place to look. When
//   `headerActions` is supplied the caller owns that whole area INCLUDING Edit,
//   so the footer's own Edit button is not rendered as well -- two Edit buttons
//   on one screen would be worse than either arrangement.
//
// Delete stays in the footer, deliberately: the kit's own comment records the
// GLOBAL rule that destructive actions are never adjacent to common ones, and
// moving Delete up next to Share would put it one pixel from a button people
// press every day.
import { useEffect, useRef, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { StatusBadge, DocumentFlow } from "@fchecklist/veridian-ui-kit/screens";
import type { DocumentFlowData, FieldMessage, StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { ScreenFrame } from "./ScreenFrame";

const AUTOSAVE_DEBOUNCE_MS = 2000; // GLOBAL: "autosave debounced ~2s"

export type ObjectScreenMode = "display" | "edit" | "create";

export type ObjectScreenProps = {
  breadcrumb: ReactNode;
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
  deleteDisabledReason?: string;
  saveDisabled?: boolean;
  saveDisabledReason?: string; // e.g. "2 required fields"
  onAutosave?: () => void | Promise<void>; // caller reads its own current form state; ObjectScreen only owns the timing
  /** R67 D-63 fork addition: this object's actions as words in the header. Suppresses the footer Edit button. */
  headerActions?: ReactNode;
  messages: FieldMessage[];
  onMessageClick?: (message: FieldMessage) => void;
  children: ReactNode; // FormSection(s) / read-only field display, anchor-section content
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
  deleteDisabledReason,
  saveDisabled,
  saveDisabledReason,
  onAutosave,
  headerActions,
  messages,
  onMessageClick,
  children,
}: ObjectScreenProps) {
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced autosave -- fires AUTOSAVE_DEBOUNCE_MS after the LAST call to
  // scheduleAutosave() while in edit/create mode.
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

  const footerActions: ReactNode = isEditing ? (
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
      {onEdit && !headerActions && (
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
          Delete
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
      headerActions={isEditing ? undefined : headerActions}
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
