"use client";

// R67 PROGRAMME DECISION D-09 — THIS IS A FORK, ON PURPOSE.
//
// Copied from @fchecklist/veridian-ui-kit/src/screens/ScreenFrame.tsx (v0.7.0)
// because the kit's SOURCE REPOSITORY IS NOT ON THIS MACHINE and the package is
// not published: the only copy is an extracted tarball under node_modules,
// which `bun install --frozen-lockfile` erases on every CI run, so editing it
// there would be a change that silently does not ship. D-09's instruction is
// therefore to fork the file into projexa, fix the imports, and keep importing
// the kit for everything that is NOT forked -- which is what this file does:
// MessageArea and the FieldMessage type still come from the kit.
//
// THE ONE BEHAVIOURAL DIFFERENCE, and why item D-63 needs it: the kit's header
// carries exactly three fixed actions (Filter | Export | + New), which is right
// for a LIST but has nothing to offer an OBJECT screen. R-203 asks for a
// meeting's own actions -- Edit | Export PDF | Share on WhatsApp | Share link --
// to be words in the header, in that order. `headerActions` is that slot. When
// a caller supplies it, it OWNS the header's action area; the three built-ins
// are not rendered alongside it, because a header showing "Filter Export + New
// Edit Export PDF Share…" would be worse than either.
//
// Everything else is byte-for-byte the upstream component, so a future kit
// release can be diffed against it.
import type { ReactNode } from "react";
import { Filter, Download, Plus } from "lucide-react";
import { MessageArea } from "@fchecklist/veridian-ui-kit/screens";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";

export type HeaderActionState = { label: string; onClick?: () => void; disabledReason?: string };

export type ScreenFrameProps = {
  breadcrumb: ReactNode;
  filterAction?: HeaderActionState;
  exportAction?: HeaderActionState;
  newAction?: HeaderActionState;
  /** R67 D-63 fork addition: this screen's own header actions, rendered as words in the order given. Replaces Filter|Export|+New when supplied. */
  headerActions?: ReactNode;
  /** Object-level state that stays visible even when the header collapses (M31), e.g. "Locked by Suresh until 14:32". */
  headerMessageStrip?: ReactNode;
  children: ReactNode;
  /** Mode-specific footer action buttons -- Save|Cancel (edit/create), Delete (display). Owned by the caller (ObjectScreen), rendered inside the never-vanishing footer bar alongside the message area. */
  footerActions?: ReactNode;
  messages: FieldMessage[];
  onMessageClick?: (message: FieldMessage) => void;
};

function HeaderActionButton({ icon: Icon, action }: { icon: typeof Filter; action?: HeaderActionState }) {
  if (!action) return null;
  const disabled = !!action.disabledReason;
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={disabled}
      title={action.disabledReason}
      className="inline-flex items-center gap-1.5 rounded-md border border-ct-border2 px-2.5 py-1.5 text-[13px] text-ct-navy hover:bg-ct-cloud disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      <Icon className="size-3.5" aria-hidden />
      {action.label}
      {disabled && <span className="text-[11px] text-ct-muted">({action.disabledReason})</span>}
    </button>
  );
}

export function ScreenFrame({ breadcrumb, filterAction, exportAction, newAction, headerActions, headerMessageStrip, children, footerActions, messages, onMessageClick }: ScreenFrameProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-ct-border shrink-0">
        <div className="text-[13px] text-ct-slate min-w-0 truncate">{breadcrumb}</div>
        {/* GLOBAL: Filter | Export | + New, same order, every LIST screen --
            unless this screen has actions of its own (R67 D-63). */}
        <div className="flex items-center gap-2 shrink-0">
          {headerActions ?? (
            <>
              <HeaderActionButton icon={Filter} action={filterAction} />
              <HeaderActionButton icon={Download} action={exportAction} />
              <HeaderActionButton icon={Plus} action={newAction} />
            </>
          )}
        </div>
      </header>

      {headerMessageStrip && (
        <div className="px-4 py-1.5 text-[12.5px] bg-ct-cloud border-b border-ct-border text-ct-navy shrink-0">{headerMessageStrip}</div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">{children}</div>

      {/* Footer bar that NEVER vanishes -- present even with zero actions, because it carries the message area (GLOBAL/M29). */}
      <footer className="border-t border-ct-border shrink-0">
        {footerActions && <div className="flex items-center gap-2 px-4 py-2.5">{footerActions}</div>}
        <MessageArea messages={messages} onMessageClick={onMessageClick} />
      </footer>
    </div>
  );
}
