"use client";

// R67 F-34 (audit recommendation R-290) -- FRAME-FIRST LOADING ON OBJECT ROUTES.
//
// MERGE NOTE. Lanes F2 and D3 forked the kit's ObjectScreen independently and
// -- reading the same decision D-11 §3 ("two different components must never
// share one import path") -- independently landed on the same name for it.
// This file is the union of the two: F-34's `loading` variant, and D-33's
// `deleteLabel` / `secondaryAction`. Each addition is marked at its own site.
// Keep this fork's diff from the kit small; anything else belongs in a kit
// release.
//
// WHY THIS IS NAMED KitObjectScreen AND NOT ObjectScreen (decision D-11
// addendum). Lanes D0 and F2 both created src/components/screens/ObjectScreen
// .tsx with incompatible interfaces. D0's is CANONICAL at that path: a
// PROJEXA-native display-first card with ProjectBreadcrumb, an inline delete
// confirmation and a persistent footer receipt. This file is the OTHER shape
// -- a verbatim fork of the KIT's ObjectScreen (ScreenFrame, mode/draft/
// autosave/messages/documentFlow), which the seven construction object pages
// below were already importing from @fchecklist/veridian-ui-kit/screens before
// this lane touched them. Folding those props into D0's component would have
// meant rewriting seven screens onto a different archetype, so D-11's own
// escape clause applies: "if a fork must survive for a genuinely different
// shape, it is renamed (KitObjectScreen) and never sits at the canonical
// path". Two components never share one import path; nothing is deleted.
//
// WHY IT IS A FORK AT ALL (programme decision D-09). The item as written asks
// for a change inside @fchecklist/veridian-ui-kit's own ObjectScreen and a kit
// release. D-09 forbids both for this programme: the kit source is not on this
// machine, it is pinned to a git commit, and an edit inside node_modules is
// erased by CI's `bun install --frozen-lockfile`. So the kit's ObjectScreen is
// copied here verbatim and extended; EVERYTHING it depends on is still
// imported from the kit (ScreenFrame, StatusBadge, DocumentFlow, the shared
// types), so this fork carries the object-screen behaviour and nothing else.
// Upstreaming the `loading` variant to the kit later is a straight copy of the
// block below.
//
// WHAT THE VARIANT FIXES. Every object route in PROJEXA answered a wait with
// one line:
//
//     if (!meeting) return <p className="p-6 …">Loading…</p>;
//
// A word, centred in an empty page, with no breadcrumb, no title, no action bar
// and nothing for a screen reader to announce. The user cannot tell it apart
// from a broken screen, and after a save it replaces the record they were just
// looking at. `<KitObjectScreen loading breadcrumb="Minutes of Meeting /
// Meeting" label="the meeting" />` renders the SAME frame the loaded screen
// renders -- the real breadcrumb, a title-shaped skeleton bar, the action bar
// present and disabled with its reason -- inside a region marked aria-busy, and
// after three seconds it says what it is waiting for, in the same words the
// list screens use (ListLoadingWords, F-31). 'Loading…' never stands alone
// again.
//
// The loaded path below is byte-for-byte the kit's, so switching a screen to
// this fork changes nothing about how it renders once its record has arrived.
//
// R67 INTEGRATION TRAIN, lane D21 (decision D-11 addendum). A THIRD lane
// forked the kit's ObjectScreen at src/components/screens/ObjectScreen.tsx --
// the path D0's PROJEXA-native archetype already owns. Per D-11 ("the version
// already merged to main is canonical; the arriving lane folds its distinct
// capability into it"), D0's component keeps that path untouched and D21's
// three fork deltas are folded in HERE, where the shape already matches:
//
//   1. `headerActions` -- a worded Export/Share slot in the object header row
//      (R-047/R-053), which ScreenFrame's own three fixed header actions
//      cannot carry.
//   2. `editDisabledReason` + disabled-with-reason Edit/Delete -- a screen
//      that cannot offer an action now says so instead of showing nothing.
//      Opt-in: a caller that passes neither handler nor reason renders no
//      control, exactly as before.
//   3. autosave arms on `onAutosave` rather than on edit mode, so a MoM's
//      minutes -- typed live on the DISPLAY page -- can actually save.
//
// Nothing was deleted: D21's nine screens now import KitObjectScreen, and
// D0's ObjectScreen keeps its own consumer and its own behaviour.


import { useEffect, useRef } from "react";
import { Pencil } from "lucide-react";
import { ScreenFrame, StatusBadge, DocumentFlow } from "@fchecklist/veridian-ui-kit/screens";
import type { DocumentFlowData, FieldMessage, StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { ListLoadingWords } from "@/components/ListScreenFrame";
import { formatTime } from "@/lib/format-date";

const AUTOSAVE_DEBOUNCE_MS = 2000; // GLOBAL: "autosave debounced ~2s"

/** The reason shown beside every action while the record is still in flight. */
export const OBJECT_LOADING_REASON = "Loading…";

export type KitObjectScreenMode = "display" | "edit" | "create";

export type KitObjectScreenLoadedProps = {
  loading?: false;
  breadcrumb: React.ReactNode;
  title: string; // "New <Object>" until named, per M29 -- caller supplies this already resolved
  subtitle?: string;
  headerStatus?: { tone: StatusTone; label: string }; // dual header/item status -- this is the HEADER half (M31)
  /**
   * R67 D-17/D-47 (R-047/R-053), folded in by the integration train: worded
   * actions -- an Export menu, a Share control -- in the object HEADER row,
   * beside the title and the status badge. ScreenFrame's own header takes
   * three fixed single-button actions (Filter | Export | + New) and cannot
   * carry a menu, so the slot lives here rather than there.
   */
  headerActions?: React.ReactNode;
  /**
   * R67 D-12 (lane D1, folded in under D-11's addendum rather than kept as a
   * third fork): a facet's value is a ReactNode, not a string. The drawings
   * object page's "Supersedes" facet has to LINK to the revision it replaced --
   * a facet that named the previous revision without going there would make the
   * reader search the register by hand. Every existing caller is unaffected: a
   * string IS a ReactNode, so this widens the prop and breaks nothing.
   */
  facets?: { label: string; value: React.ReactNode }[];
  documentFlow?: DocumentFlowData;
  mode: KitObjectScreenMode;
  hasDraft: boolean; // an existing draft the user left mid-edit (editing icon, M29)
  lockedByOther?: { userId: string; lockExpiresAt: string } | null;
  onEdit?: () => void | Promise<void>;
  onSave?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onBack?: () => void;
  /**
   * R67 D-22, folded in by the integration train: when set, Edit renders
   * DISABLED with this reason beside the word instead of vanishing. The kit
   * rendered Edit only when onEdit existed, so on every approved or
   * superseded BOQ and every published meeting the user saw no Edit and no
   * reason, and could not tell a missing feature from a broken one.
   */
  editDisabledReason?: string;
  deleteDisabledReason?: string;
  /**
   * R67 D-33 fork addition. The kit hard-codes the word "Delete" on the
   * destructive footer action. On a worker that word is a lie: the action sets
   * isActive=false and keeps every attendance row and every cost. A screen has
   * to be able to call it "Deactivate".
   *
   * R67 MERGE (D-11, lane D1 x lane D3, 2026-09-03): lane D1 arrived with an
   * IDENTICAL prop of the same name and type, declared for its own reason, and
   * the two were reconciled into this single declaration rather than left as a
   * duplicate property. D1's case, kept here because it is the one that shows
   * why the label must be per-screen and not a two-value flag: the drawings
   * object page has TWO destructive acts with different meanings and different
   * gates -- "Remove" (a hard delete inside the 24-hour grace window, the file
   * goes too) and "Dispose" (the records-management act, gated on the retention
   * policy). A screen that called both of them "Delete" would be lying about one.
   */
  deleteLabel?: string;
  /**
   * R67 D-33 fork addition. A display-mode action beside Edit -- D-33 needs
   * "Reactivate" on an inactive worker, so deactivation stops being one-way in
   * the UI. Display mode only: in edit mode the footer is Save/Cancel and a
   * third verb there would compete with them.
   */
  secondaryAction?: { label: string; onClick: () => void | Promise<void>; disabledReason?: string };
  saveDisabled?: boolean;
  saveDisabledReason?: string; // e.g. "2 required fields"
  onAutosave?: () => void | Promise<void>; // caller reads its own current form state; KitObjectScreen only owns the timing
  messages: FieldMessage[];
  onMessageClick?: (message: FieldMessage) => void;
  children: React.ReactNode; // FormSection(s) / read-only field display, anchor-section content
};

export type KitObjectScreenLoadingProps = {
  loading: true;
  /** The module's real breadcrumb literal, so it does not change when the record lands. */
  breadcrumb: React.ReactNode;
  /**
   * What the user is waiting for, in their words -- "the meeting", "the worker".
   * After 3 s the frame says "Still loading the meeting… 4 s"; at 8 s, D-04's
   * abort budget, "This is taking longer than usual". Omit only where there is
   * genuinely no noun for it.
   */
  label?: string;
  /** The action names this screen really has, drawn disabled with their reason. */
  actions?: string[];
  /** How many facet slots to outline, so the header does not resize on arrival. */
  facetCount?: number;
  onBack?: () => void;
};

export type KitObjectScreenProps = KitObjectScreenLoadedProps | KitObjectScreenLoadingProps;

/**
 * The frame an object route paints before its record exists.
 *
 * Deliberately NOT a spinner in an empty page: the breadcrumb is real text (a
 * user who navigated by mistake can tell immediately), the title is a bar the
 * real title will replace at the same size, and the action bar is present and
 * disabled rather than absent -- an action that appears late is its own kind of
 * layout jump, and one that looks live over a screen with no record yet is a
 * fail-after-click.
 */
function KitObjectScreenLoading({ breadcrumb, label, actions = ["Edit"], facetCount = 2, onBack }: KitObjectScreenLoadingProps) {
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
      footerActions={
        <>
          <span className="text-[13px] text-ct-muted">{OBJECT_LOADING_REASON}</span>
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              disabled
              aria-disabled="true"
              title={OBJECT_LOADING_REASON}
              className="rounded-md border border-ct-border2 px-3 py-1.5 text-[13px] text-ct-muted opacity-60"
            >
              {action}
            </button>
          ))}
        </>
      }
      messages={[]}
    >
      <div data-state="loading" aria-busy="true" data-testid="object-screen-loading">
        <div className="px-4 py-3 border-b border-ct-border">
          <div className="flex items-start justify-between gap-3">
            {/* Title-shaped, title-sized: the real <h1> is text-xl, so the bar
                is h-6 and the header does not change height on arrival. */}
            <div
              className="h-6 w-56 max-w-full animate-pulse rounded bg-ct-cloud"
              data-testid="object-screen-title-skeleton"
            />
          </div>
          {facetCount > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
              {Array.from({ length: facetCount }, (_, i) => (
                <div key={i} className="h-3.5 w-28 animate-pulse rounded bg-ct-cloud" />
              ))}
            </div>
          )}
        </div>
        {label ? <ListLoadingWords label={label} /> : null}
      </div>
    </ScreenFrame>
  );
}

export function KitObjectScreen(props: KitObjectScreenProps) {
  // Hooks must run in the same order on every render, so the loading branch is
  // taken AFTER them -- not with an early return above them.
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
  }, []);

  if (props.loading) return <KitObjectScreenLoading {...props} />;

  const {
    // D3 x D21 x D1 merge: the union of the three lanes' additions. D3
    // contributed `deleteLabel` (default "Delete", so no other screen changes)
    // and `secondaryAction`; D21 contributed `headerActions` and
    // `editDisabledReason`; D1 widened `facets` to ReactNode and arrived at the
    // same `deleteLabel`, which is now one declaration serving both lanes'
    // callers. Nothing is dropped -- each prop has its own caller.
    breadcrumb, title, subtitle, headerStatus, headerActions, facets, documentFlow, mode, hasDraft, lockedByOther,
    onEdit, onSave, onCancel, onDelete, onBack, editDisabledReason, deleteDisabledReason,
    deleteLabel = "Delete", secondaryAction, saveDisabled, saveDisabledReason,
    onAutosave, messages, onMessageClick, children,
  } = props;

  // Debounced autosave -- fires AUTOSAVE_DEBOUNCE_MS after the LAST call to
  // scheduleAutosave(). Exposed via a data attribute hook so the caller's
  // field onChange can trigger it without KitObjectScreen needing to know the
  // field shape.
  //
  // R67 D-17, folded in by the integration train: the ARMING CONDITION is
  // "did the caller ask for autosave", not "is the screen in edit mode". A
  // MoM's minutes are typed live, during the meeting, on the DISPLAY page --
  // there is no edit mode to enter -- so a timer armed only while editing
  // could never fire for the one field in this product that most needs it.
  // The debounce itself is unchanged and still lives in one place. A screen
  // that does not pass onAutosave is unaffected: scheduleAutosave() returns
  // immediately and onChangeCapture is not even wired up.
  function scheduleAutosave() {
    if (!onAutosave) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void onAutosave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

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
      {/* R67 D-22, folded in by the integration train: a screen that CANNOT
          offer Edit or Delete states why instead of showing nothing. It does
          that by passing a *DisabledReason without a handler -- so a caller
          that passes neither still renders no control at all, exactly as
          before, and no existing screen changes shape. */}
      {(onEdit || editDisabledReason) && (
        <button
          type="button"
          onClick={() => onEdit?.()}
          disabled={!onEdit || !!editDisabledReason}
          title={editDisabledReason}
          className="inline-flex items-center gap-1.5 rounded-md bg-ct-navy px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Edit
          {/* The reason as VISIBLE text beside the word, not a title-only
              tooltip a mouse has to hover to find. */}
          {editDisabledReason && <span className="text-[11px] font-normal">({editDisabledReason})</span>}
        </button>
      )}
      {/* FORK (D-33): the secondary display-mode action, e.g. Reactivate. Sits
          with Edit, on the non-destructive side of the spacer. */}
      {secondaryAction && (
        <button
          type="button"
          onClick={() => secondaryAction.onClick()}
          disabled={!!secondaryAction.disabledReason}
          title={secondaryAction.disabledReason}
          className="rounded-md border border-ct-border2 px-3 py-1.5 text-[13px] text-ct-navy disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {secondaryAction.disabledReason
            ? `${secondaryAction.label} (${secondaryAction.disabledReason})`
            : secondaryAction.label}
        </button>
      )}
      {/* Destructive actions are never adjacent to common ones (GLOBAL) -- a spacer, not just a gap class, keeps Delete visually separated. */}
      {(onDelete || deleteDisabledReason) && <div className="flex-1" />}
      {(onDelete || deleteDisabledReason) && (
        <button
          type="button"
          onClick={() => onDelete?.()}
          disabled={!onDelete || !!deleteDisabledReason}
          title={deleteDisabledReason}
          className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-veri-status-late)] px-3 py-1.5 text-[13px] text-[color:var(--color-veri-status-late)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {/* FORK (D-33): was the hard-coded word "Delete". D3 x D21 x D1 merge
              -- D3 made the word a prop, D21 made the reason visible text rather
              than a title-only tooltip, and D1 reached the same prop for the
              drawings page's Remove/Dispose pair. All apply: the control names
              the act it performs AND says out loud why it is not offered. */}
          {deleteLabel}
          {deleteDisabledReason && <span className="text-[11px]">({deleteDisabledReason})</span>}
        </button>
      )}
    </>
  );

  const headerMessageStrip = lockedByOther
    // R67 D-61 (swept at the merge). toLocaleTimeString() takes the RUNTIME's
    // locale AND time zone, so this sentence rendered one clock time on the
    // server and another in the reader's browser -- on a lock expiry, which is
    // the one string on the screen that has to be trusted to the minute.
    // formatTime() pins both.
    ? `Locked by another user until ${formatTime(lockedByOther.lockExpiresAt)}`
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
      <div data-veri-autosave-trigger onChangeCapture={onAutosave ? scheduleAutosave : undefined} data-state="ready">
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

export default KitObjectScreen;
