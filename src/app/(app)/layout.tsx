"use client";

import { VeriChatProvider } from "@/components/veri-chat/veri-chat-context";
import M24Shell from "@/components/shell/M24Shell";
import { ShellScreenProvider } from "@/components/shell/shell-screen-context";

// R52 PHASE A/B -- this layout now mounts the M24 shell (claude_log id=13,
// cc_spec point 187). It is the ONE place that governs all 53 app routes, so
// re-parenting here puts every routed screen inside the RIGHT 70% pane at once
// rather than editing 53 files.
//
// WHAT WAS REMOVED AND WHY:
//   AppShellFrame -> AppShell. The old frame was sidebar + fixed-width LEFT
//     working column + right column. M24 rules two panes only: LEFT 30% Task
//     Master, RIGHT 70% traditional ERP.
//   AppSidebar    -> DELETED from the shell. M24: "HOME = THE GROUPED MODULE
//     DIRECTORY, rendered in the RIGHT pane. It REPLACES the left rail, which
//     is why the rail could be deleted at all." The component still exists in
//     the repo and in the kit; it is simply no longer mounted here.
//   AppTopbar     -> TopRail. One ~36px line carrying brand | organisation |
//     PROJECT | search | alerts | account. The project is now visible at all
//     times in the only band the composer never covers, which M24 calls the
//     most expensive mistake in the product to get wrong.
//   VeriChatPanel -> no longer a separate pane. The conversation belongs
//     INSIDE the box (M24-A: "EVERYTHING HAPPENS INSIDE OUR CHAT BOX").
//
// WHAT WAS KEPT: VeriComposer, unchanged, mounted through the kit Composer's
// inputSlot. Its real /api/assistant and /api/discuss wiring is untouched.
// Phase C replaces it with the pill strip; Phase A does not rebuild it twice.
//
// LANDMARKS (R52, fault R48_DUAL_MAIN_LANDMARK_01): the SHELL owns the one
// <main>. The kit's AppShell wraps {children} in it (AppShell.tsx:94), so a
// page under (app) must render a plain <div>, never a <main> of its own --
// two visible `main` landmarks is invalid per HTML/WAI-ARIA, and it also
// breaks every automated check that reads document.querySelector("main"),
// which returns the FIRST one. Enforced by
// src/lib/single-main-landmark.test.ts. Pages OUTSIDE this layout
// (auth/callback, invite/[token], share/report/[token]) get no shell, so
// their own <main> is correct and is deliberately left alone.
//
// VeriChatProvider still wraps everything -- VeriComposer depends on it.
// The Toaster stays mounted once in the root layout (src/app/layout.tsx); a
// second instance here used to duplicate every toast.error() call, because
// both instances subscribe to the same global sonner store.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  // R67 A-03: ShellScreenProvider must sit ABOVE M24Shell, because the pages
  // that publish their resolved project are rendered as its children -- the
  // shell reads what the screen inside it resolved, rather than resolving a
  // second, independent answer of its own and disagreeing with the pane.
  return (
    <VeriChatProvider>
      <ShellScreenProvider>
        <M24Shell>{children}</M24Shell>
      </ShellScreenProvider>
    </VeriChatProvider>
  );
}
