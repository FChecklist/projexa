"use client";

// R42 seq21 (M24/M29 GLOBAL) -- the chrome every archetype shares: a
// breadcrumb, the SAME header actions in the SAME order on every screen, and a
// footer bar that NEVER vanishes (present even when every action is disabled)
// because it carries the message area.
//
// ─── PROJEXA FORK, R67 (programme decision D-09) ────────────────────────────
// This file is a COPY of @fchecklist/veridian-ui-kit/src/screens/
// ScreenFrame.tsx, taken at kit version 0.7.0 (the commit projexa's
// package.json pins). It is forked, not patched, because the kit's source is
// not on this machine and is not published -- editing node_modules is erased by
// CI's `bun install --frozen-lockfile`, and a kit release is out of scope for
// this programme. MessageArea and the shared types are still imported FROM the
// kit, so only this one component diverges, and every screen that does not need
// the two additions below keeps importing ScreenFrame from the kit unchanged.
//
// The divergence is exactly two additions, both required by R67 D-44:
//
//   extraActions   The kit has exactly three header slots (Filter | Export |
//                  + New). D-44's Schedule header is four, in the fixed order
//                  Filter | Export | Import | + New, so there has to be a slot
//                  BETWEEN Export and + New. It is an ordered array rather than
//                  a single prop so the same mechanism serves any module that
//                  later needs a fifth; the order given is the order rendered
//                  and is never re-sorted.
//
//   accessible name = the bare label. The kit renders a disabled action's
//                  reason inside the button, which makes the button's
//                  ACCESSIBLE NAME "Import (Not available yet)" -- so a screen
//                  reader user hears the reason as part of the control's
//                  identity, and an acceptance test can no longer name the
//                  control at all. Here the reason stays VISIBLE beside the
//                  label (the programme's "a greyed-out control must say why"
//                  rule) but is aria-hidden, with an explicit aria-label and
//                  the reason repeated in the title. The reason is still
//                  announced -- as the description, via aria-describedby --
//                  which is where a reason belongs.
import type { ReactNode } from "react";
import { Filter, Download, Plus, Upload } from "lucide-react";
import { MessageArea } from "@fchecklist/veridian-ui-kit/screens";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";

export type HeaderActionState = {
  label: string;
  onClick?: () => void;
  disabledReason?: string;
  /** Lucide icon for an extraActions entry. Defaults to Upload (the Import case D-44 adds). */
  icon?: typeof Filter;
  /** Stable hook for acceptance tests. */
  testId?: string;
};

export type ScreenFrameProps = {
  breadcrumb: ReactNode;
  filterAction?: HeaderActionState;
  exportAction?: HeaderActionState;
  /** FORK: rendered between Export and + New, in the order given. */
  extraActions?: HeaderActionState[];
  newAction?: HeaderActionState;
  /** Object-level state that stays visible even when the header collapses (M31), e.g. "Locked by Suresh until 14:32". */
  headerMessageStrip?: ReactNode;
  children: ReactNode;
  /** Mode-specific footer action buttons -- owned by the caller, rendered inside the never-vanishing footer bar alongside the message area. */
  footerActions?: ReactNode;
  messages: FieldMessage[];
  onMessageClick?: (message: FieldMessage) => void;
};

function HeaderActionButton({ icon: Icon, action }: { icon: typeof Filter; action?: HeaderActionState }) {
  if (!action) return null;
  const disabled = !!action.disabledReason;
  const reasonId = disabled ? `screen-action-reason-${action.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}` : undefined;
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={disabled}
      title={action.disabledReason}
      // FORK: the control is named by its label alone; the reason is its
      // description. See this file's header for why.
      aria-label={action.label}
      aria-describedby={reasonId}
      data-testid={action.testId}
      className="inline-flex items-center gap-1.5 rounded-md border border-ct-border2 px-2.5 py-1.5 text-[13px] text-ct-navy hover:bg-ct-cloud disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      <Icon className="size-3.5" aria-hidden />
      <span aria-hidden>{action.label}</span>
      {disabled && (
        <span id={reasonId} className="text-[11px] text-ct-muted">
          ({action.disabledReason})
        </span>
      )}
    </button>
  );
}

export function ScreenFrame({
  breadcrumb,
  filterAction,
  exportAction,
  extraActions,
  newAction,
  headerMessageStrip,
  children,
  footerActions,
  messages,
  onMessageClick,
}: ScreenFrameProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-ct-border shrink-0">
        <div className="text-[13px] text-ct-slate min-w-0 truncate">{breadcrumb}</div>
        {/* GLOBAL: Filter | Export | + New, same order, every screen -- with
            FORK's extraActions slotted in immediately before + New. */}
        <div className="flex items-center gap-2 shrink-0">
          <HeaderActionButton icon={Filter} action={filterAction} />
          <HeaderActionButton icon={Download} action={exportAction} />
          {(extraActions ?? []).map((action) => (
            <HeaderActionButton key={action.label} icon={action.icon ?? Upload} action={action} />
          ))}
          <HeaderActionButton icon={Plus} action={newAction} />
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
