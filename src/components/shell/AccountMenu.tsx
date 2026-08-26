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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// R52 Gate 2 / F_025. THE RECORDED DIAGNOSIS NO LONGER HOLDS, and it matters
// which half of it survives.
//
// F_025 reads: "the account/user menu shown in the LEFT SIDEBAR displays
// democeo@projexa-ai.com ... the app falls back to a cached/default profile
// (democeo@) instead of erroring". Two things are now false. The left sidebar
// is gone -- M24 deleted the rail and this control replaced the inline menu in
// AppTopbar. And there is no cached/default profile anywhere in this path:
// `email` is threaded from GET /api/organization, which returns
// `email: ctx.user!.email` -- the authenticated principal itself
// (src/app/api/organization/route.ts:26). Nothing here can display a different
// user's address; grep for "democeo" across src/ returns nothing.
//
// What DID survive is the honest core of the fault -- identity display must
// never be quietly wrong. With the org call failing, `email` arrived undefined
// and this menu simply rendered a "PX" avatar and no address at all, which
// reads as "signed in, nothing to report" rather than "we could not read who
// you are". A profile-less session is exactly the case the fault was raised
// from. So the unknown case is now stated instead of styled away.
export default function AccountMenu({ email }: { email?: string }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const identityKnown = Boolean(email);
  // "?" rather than the product's own initials: a placeholder that looks like a
  // real account badge is how an unknown identity passes for a known one.
  const initials = identityKnown ? email!.slice(0, 2).toUpperCase() : "?";

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-[var(--color-ct-cloud)]"
          aria-label={identityKnown ? `Account: ${email}` : "Account — signed-in identity could not be read"}
        >
          <Avatar className="h-5 w-5">
            <AvatarFallback className="bg-ct-saffron text-white text-[9px] font-bold">{initials}</AvatarFallback>
          </Avatar>
          <ChevronDown className="size-3" style={{ color: "var(--color-ct-muted)" }} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <div className="truncate px-2 py-1.5 text-xs" style={{ color: identityKnown ? "var(--color-ct-muted)" : "var(--color-veri-status-late)" }}>
          {identityKnown ? email : "Signed-in identity unavailable"}
        </div>
        <DropdownMenuSeparator />
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
