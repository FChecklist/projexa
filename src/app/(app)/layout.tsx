"use client";

import { VeriChatProvider } from "@/components/veri-chat/veri-chat-context";
import M24Shell from "@/components/shell/M24Shell";

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
// VeriChatProvider still wraps everything -- VeriComposer depends on it.
// The Toaster stays mounted once in the root layout (src/app/layout.tsx); a
// second instance here used to duplicate every toast.error() call, because
// both instances subscribe to the same global sonner store.
// R52 Gate 2 / R48_DUAL_MAIN_LANDMARK_01 -- THE ONE <main> LIVES IN THE KIT.
// AppShell renders the right-hand module pane as <main> and the Task Master
// column as <aside> (veridian-ui-kit/src/shell/AppShell.tsx:83-96). Every page
// under this layout ALSO opened its own <main className="flex-1 space-y-6 p-6">
// inside that one, so each route shipped two main landmarks -- nested, which
// HTML forbids outright, and which gives a screen-reader user two "main"
// regions with no way to tell which is the page. Those 51 page-level elements
// are now <div>. NOTHING under (app) may reintroduce a <main>; the pages
// outside this group (auth/callback, invite/[token], share/report/[token]) do
// not mount AppShell and correctly keep their own.
//
// The fault also records the measurement damage this caused --
// document.querySelector("main") returning the assistant column -- and that is
// why R48_BLANK_CONTENT_NO_CREDENTIALS_01's "127 characters of rendered main"
// evidence has to be re-taken rather than trusted.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <VeriChatProvider>
      <M24Shell>{children}</M24Shell>
    </VeriChatProvider>
  );
}
