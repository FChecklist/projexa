"use client";

// R67 F-34 (audit recommendation R-290) -- FRAME-FIRST LOADING ON OBJECT ROUTES.
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
   * R67 D-12 (lane D1, folded in under D-11's addendum rather than kept as a
   * third fork): a facet's value is a ReactNode, not a string. The drawings
   * object page's "Supersedes" facet has to LINK to the revision it replaced --
   * a facet that named the previous revision without going there would make the
   * reader search the register by hand. Every existing caller is unaffected: a
   * string IS a ReactNode.
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
   * R67 D-11 (lane D1, folded in under D-11's addendum). The verb this screen's
   * destructive action actually performs. Defaults to the kit's "Delete", which
   * is right for a permit (D-05) and wrong for a drawing: the drawings object
   * page has TWO destructive acts with different meanings and different gates --
   * "Remove" (a hard delete inside the 24-hour grace window, the file goes too)
   * and "Dispose" (the records-management act, gated on the retention policy).
   * A screen that called both of them "Delete" would be lying about one.
   */
  deleteLabel?: string;
  deleteDisabledReason?: string;
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
    breadcrumb, title, subtitle, headerStatus, facets, documentFlow, mode, hasDraft, lockedByOther,
    onEdit, onSave, onCancel, onDelete, onBack, deleteLabel = "Delete", deleteDisabledReason, saveDisabled, saveDisabledReason,
    onAutosave, messages, onMessageClick, children,
  } = props;

  // Debounced autosave -- fires AUTOSAVE_DEBOUNCE_MS after the LAST call to
  // scheduleAutosave() while in edit/create mode. Exposed via a data
  // attribute hook so the caller's field onChange can trigger it without
  // KitObjectScreen needing to know the field shape.
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
      <div data-veri-autosave-trigger onChangeCapture={isEditing ? scheduleAutosave : undefined} data-state="ready">
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

export default KitObjectScreen;
