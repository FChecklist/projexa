"use client";

// Forked from @fchecklist/veridian-ui-kit/src/screens/ScreenFrame.tsx per
// programme decision D-09 (no kit release in this programme; a kit
// behaviour change is forked into projexa, and everything not forked keeps
// importing the kit). The kit copy is UNCHANGED and still used everywhere
// else -- ONLY DashboardScreen.tsx (itself already a fork) imports this
// one instead of the kit's, so this has zero effect on the ~50 other
// screens (every ObjectScreen/ListScreen/EditScreen/CreateScreen/etc.
// still gets the kit's own ScreenFrame, byte for byte). Editing
// node_modules directly is erased by CI's frozen-lockfile install.
//
// R42 seq21 (M24/M29 GLOBAL)'s own layout comment is carried over
// verbatim below and is still true of this fork.
//
// THE ONE DIFFERENCE, AND WHY (2026-09-07). Owner direction, verbatim:
// "copy it exactly... object by object... exactly means exactly" -- the
// frozen mock renders Filter/Export/+New as plain muted text links, not
// bordered buttons with an icon and a "(reason)" caption. Fixed by giving
// `HeaderActionButton` the mock's own drawing: a plain `<button>` with no
// border, no background, no icon -- text only, muted further while
// disabled. The disabled REASON is not deleted (that would be losing real
// information the mock's own rough prototype never modelled, not a visual
// change) -- it stays as the `title` attribute, exactly the same
// "supplementary text, never the only label" pattern this shell already
// uses everywhere else (Composer.tsx's Send, ControlStrip's Reset).
import type { ReactNode } from "react";
import { Filter, Download, Plus } from "lucide-react";
import { MessageArea } from "@fchecklist/veridian-ui-kit/screens";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
// (FieldMessage is re-exported from the kit's screens/index.ts via
// `export * from "./types"` -- same import path KitObjectScreen.tsx
// already uses for the same type.)

export type HeaderActionState = { label: string; onClick?: () => void; disabledReason?: string };

export type ScreenFrameProps = {
  breadcrumb: ReactNode;
  filterAction?: HeaderActionState;
  exportAction?: HeaderActionState;
  newAction?: HeaderActionState;
  headerMessageStrip?: ReactNode;
  children: ReactNode;
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
      // 2026-09-07 -- mock-exact: plain text, muted, no border/background/
      // icon. `Icon` stays an accepted prop (unused in the drawing) so the
      // call sites below don't need to change, and so a future revert to
      // the bordered-button treatment is a one-line diff, not a rewrite.
      className="text-[13px] text-ct-muted hover:text-ct-navy hover:underline disabled:opacity-50 disabled:hover:no-underline disabled:cursor-not-allowed"
    >
      {action.label}
    </button>
  );
}

export function ScreenFrame({ breadcrumb, filterAction, exportAction, newAction, headerMessageStrip, children, footerActions, messages, onMessageClick }: ScreenFrameProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-ct-border shrink-0">
        <div className="text-[13px] text-ct-slate min-w-0 truncate">{breadcrumb}</div>
        {/* GLOBAL: Filter | Export | + New, same order, every screen. */}
        <div className="flex items-center gap-3 shrink-0">
          <HeaderActionButton icon={Filter} action={filterAction} />
          <HeaderActionButton icon={Download} action={exportAction} />
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
