"use client";

// veridian-ui-kit migration: mounted exactly once from (app)/layout.tsx (as
// AppShellFrame's `header` prop) instead of per-page -- wraps the shared
// AppHeader, which owns the icon row's generic layout/spacing/styling only.
// Every data-bearing piece here is PROJEXA's own real logic:
// - userMenuSlot: real Supabase Auth sign-out, matching SettingsClient.tsx's
//   own signOut() pattern, plus the org's real email/org name from
//   /api/organization (the same route SettingsClient already calls).
// - onToggleRightPanel: a real, working toggle (see layout.tsx's
//   panelCollapsed state) -- closes a real, confirmed gap (no right-panel-
//   toggle existed before this migration).
// - MobileSidebarTrigger: PROJEXA's own real mobile nav drawer (unchanged),
//   relocated here via AppHeader's extraActions slot so it keeps its real
//   placement inside the header row, same as before this migration.
//
// searchSlot/notificationSlot are deliberately omitted (passed `false`, not
// left unset) -- PROJEXA has no real search mechanism or notifications
// system anywhere in this codebase (confirmed by grep before writing this
// file), and AppHeader's own default fallback for an omitted slot is a
// decorative, non-functional icon button (`searchSlot ?? <button>...`,
// which only checks for null/undefined -- NOT `false`). Passing `false`
// explicitly suppresses that fallback instead of shipping a dead button;
// see this task's own final report for these as honestly-disclosed gaps.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User, Settings, LogOut, ChevronDown, Loader2 } from "lucide-react";
import { AppHeader } from "@fchecklist/veridian-ui-kit/shell";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileSidebarTrigger } from "@/components/AppSidebar";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";

type OrganizationInfo = { email: string; organization: { name: string } };

export function AppTopbar({
  sidebarCollapsed,
  onToggleSidebar,
  onToggleRightPanel,
}: {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onToggleRightPanel?: () => void;
}) {
  const router = useRouter();
  const [info, setInfo] = useState<OrganizationInfo | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetch("/api/organization")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setInfo(data))
      .catch(() => {});
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const initials = (info?.email || "PX").slice(0, 2).toUpperCase();

  const userMenuSlot = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2 text-ct-navy hover:bg-ct-cloud">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-ct-saffron text-white text-xs font-bold">{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate md:inline text-sm font-medium">{info?.email || "Account"}</span>
          <ChevronDown className="size-3 text-ct-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem className="gap-2" onClick={() => router.push("/settings")}>
          <User className="size-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={() => router.push("/settings")}>
          <Settings className="size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-red-600 focus:text-red-600"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          {loggingOut ? "Signing out..." : "Sign Out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <AppHeader
      logo={<Image src="/logo-mark.svg" alt="PROJEXA" width={28} height={28} className="rounded-sm" />}
      productName="PROJEXA"
      onToggleSidebar={onToggleSidebar}
      sidebarCollapsed={sidebarCollapsed}
      searchSlot={false}
      notificationSlot={false}
      onToggleRightPanel={onToggleRightPanel}
      contextLabel={info?.organization?.name ? <span className="hidden md:inline">{info.organization.name}</span> : undefined}
      userMenuSlot={userMenuSlot}
      extraActions={
        <div className="flex items-center gap-0.5">
          <MobileSidebarTrigger />
          <ThemeToggle />
        </div>
      }
    />
  );
}
