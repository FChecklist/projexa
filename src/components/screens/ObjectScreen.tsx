"use client";

// PROJEXA-LOCAL FORK of @fchecklist/veridian-ui-kit/screens/ObjectScreen.
//
// WHY A FORK AND NOT A KIT RELEASE (programme decision D-09): the kit's source
// is not on this machine and the package is not published -- projexa pins a
// git commit (package.json) and compiles the raw src through
// transpilePackages. Editing node_modules is erased by CI's
// `bun install --frozen-lockfile`, so the only honest way to change this
// component's BEHAVIOUR is to copy it here, re-point the screens that need the
// change, and leave every other screen importing the kit until its own item
// forks it. Everything this file does not own -- ScreenFrame, StatusBadge,
// DocumentFlow, the shared types -- is still imported from the kit, so this is
// a fork of one component, not of the kit.
//
// WHAT DIFFERS FROM THE KIT VERSION, and why (R67 D-17 / D-22):
//
//  1. EDIT AND DELETE ARE ALWAYS RENDERED IN DISPLAY MODE.
//     The kit renders Edit only when onEdit exists (its line 107) and Delete
//     only when onDelete exists (its line 114). ScopeObjectClient passed
//     onDelete for drafts only and MoMObjectClient passed onEdit for unpublished
//     meetings only -- so on every approved or superseded BOQ, and on every
//     published meeting (the majority of rows in both), the user saw no Edit,
//     no Delete and NO REASON, and could not tell a missing feature from a
//     broken one. Here both are always present; a caller that cannot offer one
//     passes editDisabledReason / deleteDisabledReason and the button renders
//     disabled with that reason as VISIBLE TEXT beside the word, not only as a
//     title attribute a mouse has to hover to find.
//
//  2. AUTOSAVE FIRES IN DISPLAY MODE TOO, WHEN onAutosave IS SUPPLIED.
//     The kit only arms its (already correct, 2s) debounce while
//     mode === "edit" | "create". A MoM's minutes are typed live, during the
//     meeting, on the DISPLAY page -- there is no "edit mode" to enter -- so
//     the kit's own timer could never fire for the one field in this product
//     that most needs it. The debounce itself is unchanged and still lives in
//     one place; only the arming condition moved from "is editing" to "did the
//     caller ask for autosave".
//
//  3. A headerActions SLOT.
//     R-047/R-053 asked for a worded Export menu in the object header rather
//     than a ghost icon-link buried in the body. ScreenFrame's own header
//     takes three fixed single-button actions (Filter | Export | + New) and
//     cannot carry a menu, so the slot renders in the object header block --
//     the row that already carries the title and the status badge.
//
// Everything else is the kit's code, kept deliberately close to the original
// so a future kit release can be diffed against it.
import { useEffect, useRef } from "react";
import { Pencil } from "lucide-react";
import { ScreenFrame, StatusBadge, DocumentFlow } from "@fchecklist/veridian-ui-kit/screens";
import type { DocumentFlowData, FieldMessage, StatusTone } from "@fchecklist/veridian-ui-kit/screens";

const AUTOSAVE_DEBOUNCE_MS = 2000; // GLOBAL: "autosave debounced ~2s"

export type ObjectScreenMode = "display" | "edit" | "create";

export type ObjectScreenProps = {
  breadcrumb: React.ReactNode;
  title: string;
  subtitle?: string;
  headerStatus?: { tone: StatusTone; label: string };
  /** FORK: worded actions (e.g. an Export menu) in the object header row. */
  headerActions?: React.ReactNode;
  facets?: { label: string; value: string }[];
  documentFlow?: DocumentFlowData;
  mode: ObjectScreenMode;
  hasDraft: boolean;
  lockedByOther?: { userId: string; lockExpiresAt: string } | null;
  onEdit?: () => void | Promise<void>;
  onSave?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onBack?: () => void;
  /** FORK: when set, Edit renders disabled with this reason beside the word. */
  editDisabledReason?: string;
  /** FORK: as above for Delete. Previously the only way to express "you cannot delete this" was to omit onDelete, which said nothing. */
  deleteDisabledReason?: string;
  saveDisabled?: boolean;
  saveDisabledReason?: string;
  onAutosave?: () => void | Promise<void>;
  messages: FieldMessage[];
  onMessageClick?: (message: FieldMessage) => void;
  children: React.ReactNode;
};

export function ObjectScreen({
  breadcrumb,
  title,
  subtitle,
  headerStatus,
  headerActions,
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
  editDisabledReason,
  deleteDisabledReason,
  saveDisabled,
  saveDisabledReason,
  onAutosave,
  messages,
  onMessageClick,
  children,
}: ObjectScreenProps) {
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // A control with no handler is as unusable as one with a reason, so both
  // count as disabled -- but only a reason is ever SHOWN, and every caller in
  // this repo supplies one whenever it withholds the handler.
  const editDisabled = !onEdit || !!editDisabledReason;
  const deleteDisabled = !onDelete || !!deleteDisabledReason;

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
      <button
        type="button"
        onClick={() => onEdit?.()}
        disabled={editDisabled}
        title={editDisabledReason}
        className="inline-flex items-center gap-1.5 rounded-md bg-ct-navy px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Edit
        {/* The reason as VISIBLE text beside the word, in the same shape
            ScreenFrame's own header actions already use for a disabled
            action -- not a title-only tooltip. */}
        {editDisabledReason && <span className="text-[11px] font-normal">({editDisabledReason})</span>}
      </button>
      {/* Destructive actions are never adjacent to common ones (GLOBAL) -- a
          spacer, not just a gap class, keeps Delete visually separated. The
          kit made this spacer conditional on onDelete; Delete is now always
          there, so the spacer always is too. */}
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => onDelete?.()}
        disabled={deleteDisabled}
        title={deleteDisabledReason}
        className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-veri-status-late)] px-3 py-1.5 text-[13px] text-[color:var(--color-veri-status-late)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Delete
        {deleteDisabledReason && <span className="text-[11px]">({deleteDisabledReason})</span>}
      </button>
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
      <div data-veri-autosave-trigger onChangeCapture={onAutosave ? scheduleAutosave : undefined}>
        <div className="px-4 py-3 border-b border-ct-border">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-heading text-xl text-ct-navy flex items-center gap-2">
                {title}
                {hasDraft && !isEditing && <Pencil className="size-3.5 text-ct-muted" aria-label="Draft in progress" />}
              </h1>
              {subtitle && <p className="text-[13px] text-ct-muted mt-0.5">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {headerActions}
              {headerStatus && <StatusBadge tone={headerStatus.tone} label={headerStatus.label} />}
            </div>
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
