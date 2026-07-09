"use client";

// Shared collapse state for AppSidebar + AppTopbar's toggle button.
// AppTopbar is rendered per-page (not from a single shared layout the way
// VERIDIAN's AppShell.tsx does it), so a context avoids prop-drilling
// sidebarCollapsed/onToggleSidebar through every page. See
// VERI_CHAT_COMPOSER_DESIGN.md's core UX #6 (resizable, collapsible
// sidebars) -- same behavior, adapted to PROJEXA's per-page topbar layout.
import { createContext, useContext, useState, type ReactNode } from "react";

type SidebarState = { collapsed: boolean; toggle: () => void };

const SidebarContext = createContext<SidebarState | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SidebarContext.Provider value={{ collapsed, toggle: () => setCollapsed((c) => !c) }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
