"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AppShellFrame } from "@fchecklist/veridian-ui-kit/shell";
import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { VeriChatProvider, HOME_ROUTE } from "@/components/veri-chat/veri-chat-context";
import VeriComposer from "@/components/veri-chat/VeriComposer";
import VeriChatPanel from "@/components/veri-chat/VeriChatPanel";
import HomeThreadSlot from "@/components/veri-chat/HomeThreadSlot";

// Owner directive 2026-07-18: navigation/shell behavior must exactly match
// compliance-tracker/veridian-scope-selector-in-home.html (the agreed UI/UX
// reference) -- including the merged-Home-page pattern, where VeriChatPanel
// merges into the main content area instead of sitting in its own side
// panel. AppShellFrame (from @fchecklist/veridian-ui-kit) now owns that
// merge mechanics generically -- ported from compliance-tracker's own real
// migration (PR #471) to the shared package's real shell/composer/panel/
// header components, unconditionally (PROJEXA has no existing feature-flag
// gate to preserve, unlike compliance-tracker's veriChatV2Enabled branch --
// this is a newer, smaller product with less blast radius). VeriComposer/
// VeriChatPanel stay PROJEXA's own components (real, already-working
// /api/assistant, /api/discuss, /api/todos, /api/conversations wiring) --
// only their outer chrome now comes from the shared package, see those
// files' own header comments for exactly what did and didn't move.
function ShellBody({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const isHome = pathname === HOME_ROUTE;

  return (
    <AppShellFrame
      homeRoute={HOME_ROUTE}
      header={
        <AppTopbar
          sidebarCollapsed={collapsed}
          onToggleSidebar={() => setCollapsed((v) => !v)}
        />
      }
      sidebar={
        collapsed
          ? null
          : (
            <AppSidebar
              middleColumnToggle={isHome ? undefined : { collapsed: panelCollapsed, onToggle: () => setPanelCollapsed((v) => !v) }}
            />
          )
      }
      composer={<VeriComposer />}
      panel={panelCollapsed ? null : <VeriChatPanel />}
      homeThreadSlot={<HomeThreadSlot />}
    >
      {children}
    </AppShellFrame>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <VeriChatProvider>
      <ShellBody>{children}</ShellBody>
      {/* Toaster is mounted once in the root layout (src/app/layout.tsx)
          with position="top-right" richColors -- a second instance here
          used to duplicate every toast.error() call (both instances
          subscribe to the same global sonner store), which made write
          failures look inconsistent/easy to miss during testing instead
          of a single clear error. */}
    </VeriChatProvider>
  );
}
