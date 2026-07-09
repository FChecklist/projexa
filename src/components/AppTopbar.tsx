"use client";

import { PanelLeft } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/sidebar-context";

export function AppTopbar({ title }: { title: string }) {
  const { collapsed, toggle } = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-px-ink2 bg-px-ink px-4 shadow-nav">
      <div className="lg:hidden">
        <AppSidebar />
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        title={collapsed ? "Show sidebar" : "Hide sidebar"}
        className="hidden text-white/80 hover:bg-white/10 hover:text-white lg:inline-flex"
      >
        <PanelLeft className="size-4" />
      </Button>
      <h1 className="font-heading text-base font-semibold text-white">{title}</h1>
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
      </div>
    </header>
  );
}
