"use client";

import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { VeriChatProvider } from "@/components/veri-chat/veri-chat-context";
import VeriComposer from "@/components/veri-chat/VeriComposer";
import VeriChatPanel from "@/components/veri-chat/VeriChatPanel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SidebarProvider } from "@/components/sidebar-context";

// Owner directive 2026-07-18: navigation/shell behavior must exactly match
// compliance-tracker/veridian-scope-selector-in-home.html (the agreed UI/UX
// reference) -- including the merged-Home-page pattern, where VeriChatPanel
// merges into the main content area instead of sitting in its own side
// panel. Ported here as the same direct pathname-conditional fix applied to
// VERIDIAN AI OS's own AppShell.tsx (see that repo's
// feat/home-page-merge-panel-fix), using PROJEXA's OWN existing
// VeriComposer/VeriChatPanel (real, already-working /api/assistant,
// /api/discuss, /api/todos, /api/conversations wiring) rather than the
// shared veridian-ui-kit package's generic composer/panel components --
// swapping those in here would mean re-deriving that real data wiring
// against a different callback surface for no behavioral gain, given
// PROJEXA's dashboard is the designated home route either way.
const HOME_ROUTE = "/dashboard";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === HOME_ROUTE;

  return (
    <SidebarProvider>
      <VeriChatProvider>
        <div className="flex h-screen overflow-hidden bg-background">
          <AppSidebar />
          {isHome ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-auto">{children}</div>
              <VeriComposer />
            </div>
          ) : (
            <ResizablePanelGroup direction="horizontal" autoSaveId="projexa-shell-panels" className="flex-1 overflow-hidden">
              <ResizablePanel defaultSize={72} minSize={50}>
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-auto">{children}</div>
                  <VeriComposer />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={28} minSize={18} maxSize={40}>
                <VeriChatPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
        {/* Toaster is mounted once in the root layout (src/app/layout.tsx)
            with position="top-right" richColors -- a second instance here
            used to duplicate every toast.error() call (both instances
            subscribe to the same global sonner store), which made write
            failures look inconsistent/easy to miss during testing instead
            of a single clear error. */}
      </VeriChatProvider>
    </SidebarProvider>
  );
}
