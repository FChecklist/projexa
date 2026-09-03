"use client";

// R52: the account control for the M24 top rail.
//
// M24's top rail is "brand | organisation | PROJECT (tinted, click-to-switch) |
// search | alerts | account". Search and alerts already had real
// implementations (search-command.tsx's palette and NotificationBell's
// dropdown) and are reused as-is. Account did not exist as a standalone
// component -- it was inline in AppTopbar, which the M24 shell no longer
// mounts. This is that control lifted out so the behaviour survives the shell
// change: Profile, Settings, Sign Out, with the same routes and the same
// supabase.auth.signOut() call. Nothing about it is new.
//
// Kept deliberately compact: the top rail is ~36px and is the one band the
// composer never covers, so it must not grow.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, LogOut, Settings, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { rememberSelectedProject } from "@/lib/project-cookie";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function AccountMenu({ email }: { email?: string }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const initials = (email || "PX").slice(0, 2).toUpperCase();

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    // Before the session goes: the selected-project cookie outlives it by 30
    // days otherwise, and the NEXT person to sign in on this browser gets the
    // previous user's project resolved server-side with no network call --
    // which VERIDIAN answers with zero rows and no error, i.e. a list screen
    // calmly saying "there are none" about somebody else's project.
    rememberSelectedProject(null);
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-[var(--color-ct-cloud)]"
          aria-label={email ? `Account: ${email}` : "Account"}
        >
          <Avatar className="h-5 w-5">
            <AvatarFallback className="bg-ct-saffron text-ct-navy text-[9px] font-bold">{initials}</AvatarFallback>
          </Avatar>
          <ChevronDown className="size-3" style={{ color: "var(--color-ct-muted)" }} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {email && (
          <>
            <div className="truncate px-2 py-1.5 text-xs" style={{ color: "var(--color-ct-muted)" }}>
              {email}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
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
}
