"use client";

// R52: the account control for the M24 top rail.
//
// M24's top rail is "brand | organisation | PROJECT (tinted, click-to-switch) |
// search | alerts | account". Search and alerts already had real
// implementations (search-command.tsx's palette and NotificationBell's
// dropdown) and are reused as-is. Account did not exist as a standalone
// component -- it was inline in AppTopbar, which the M24 shell no longer
// mounts. This is that control lifted out so the behaviour survives the shell
// change: Profile, Settings, Sign Out, with the same routes. Sign Out ends the
// session through signOutEverywhere (LOCAL-FIRST R9: the workspace step, then
// the durable identity, the worker's caches and the Supabase session).
//
// Kept deliberately compact: the top rail is ~36px and is the one band the
// composer never covers, so it must not grow.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, LogOut, Settings, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { rememberSelectedProject } from "@/lib/project-cookie";
import { clearBoqDeviceCopiesOnSignOut } from "@/lib/boq-line-cache";
import { SIGN_OUT_AND_DELETE_LABEL, signOutEverywhere } from "@/lib/local-first/sign-out-everywhere";
import { InstallMenuItem } from "@/components/local-first/InstallMenuItem";
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

  // LOCAL-FIRST (package lf-fc, cost:COST-05): "Sign Out" KEEPS this laptop's copy of the workspace (signing in again costs nothing
  // and works offline at once); "Sign out and delete this laptop's copy" is the one explicit choice that removes it.
  async function handleLogout(deleteLocalCopy = false) {
    setLoggingOut(true);
    const supabase = createClient();
    // Before the session goes: the selected-project cookie outlives it by 30
    // days otherwise, and the NEXT person to sign in on this browser gets the
    // previous user's project resolved server-side with no network call --
    // which VERIDIAN answers with zero rows and no error, i.e. a list screen
    // calmly saying "there are none" about somebody else's project.
    rememberSelectedProject(null);
    // The device copy of a project's BOQ must not outlive the session on a shared browser.
    await clearBoqDeviceCopiesOnSignOut();
    // LOCAL-FIRST: while the session is still alive, send what was made offline; keep this laptop's copy of the person's workspace
    // (or delete it, when they chose so and nothing is pending; a delete that cannot complete is said). THEN the deliberate sign-out
    // (R9): the durable identity mirror is cleared (so nothing signs the person back in), the worker drops their release caches, and
    // the Supabase session ends (by hand when the server cannot be reached). Never throws, never waits more than a few seconds.
    const { notice: localNotice } = await signOutEverywhere({ auth: supabase.auth, deleteLocalCopy });
    if (localNotice) toast.message(localNotice, { duration: 20_000 });
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
        {/* LOCAL-FIRST R10: renders nothing unless the browser has offered installation (one calm action, never a popup). */}
        <InstallMenuItem />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-red-600 focus:text-red-600"
          onClick={() => void handleLogout(false)}
          disabled={loggingOut}
        >
          {loggingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          {loggingOut ? "Signing out..." : "Sign Out"}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2 text-xs text-red-600 focus:text-red-600"
          onClick={() => void handleLogout(true)}
          disabled={loggingOut}
        >
          <LogOut className="size-4" />
          {SIGN_OUT_AND_DELETE_LABEL}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
