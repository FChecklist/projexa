"use client";

// LOCAL-FIRST shell: who is signed in, at the top right, with the calm actions that belong to that (sign out). The email used to be
// a loose line that wrapped under the module links; this is the one fixed place for it. Plain <details>, so it opens with no library
// and works the same offline. Sign-out is the same one the rest of the app uses (the workspace step, the durable identity, the
// session), and by default it KEEPS this laptop's copy so signing in again costs nothing.

import { useState } from "react";
import type { ShellData } from "./context";

const ROLE_WORDS: Record<string, string> = {
  admin: "Administrator", owner: "Owner", manager: "Manager", member: "Member", team_member: "Team member", viewer: "Viewer",
};

export function roleLabel(role: string | null): string | null {
  if (!role) return null;
  return ROLE_WORDS[role] ?? role.replace(/_/g, " ");
}

export function LocalShellAccount({ data }: { data: ShellData }) {
  const [busy, setBusy] = useState(false);
  const who = data.email ?? data.name ?? "Signed in";
  const initials = who.slice(0, 2).toUpperCase();
  const role = roleLabel(data.role);

  async function signOut(deleteLocalCopy: boolean) {
    setBusy(true);
    try {
      const [{ createClient }, { signOutEverywhere }] = await Promise.all([
        import("@/lib/supabase/client"),
        import("../sign-out-everywhere"),
      ]);
      await signOutEverywhere({ auth: createClient().auth, deleteLocalCopy });
    } catch {
      /* never hold a sign-out hostage: go to the sign-in page anyway */
    }
    window.location.assign("/login");
  }

  return (
    <details className="relative" data-testid="local-shell-account">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 text-sm text-px-ink hover:bg-black/5"
        aria-label={`Account: ${who}`}
      >
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-px-ink text-[10px] font-semibold text-white">{initials}</span>
        <span data-testid="local-shell-person" className="max-w-[16rem] truncate">{who}</span>
        <span aria-hidden className="text-px-muted">▾</span>
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-black/10 bg-white p-3 text-sm shadow-lg">
        <p className="truncate font-medium text-px-ink">{data.name ?? who}</p>
        {data.name && data.email ? <p className="truncate text-xs text-px-muted">{data.email}</p> : null}
        {role ? <p className="mt-1 text-xs text-px-muted">{role}</p> : null}
        <p className="mt-1 text-xs text-px-muted">
          {data.projects.length === 0
            ? "No projects are copied to this laptop for this account."
            : `${data.projects.length} ${data.projects.length === 1 ? "project is" : "projects are"} saved on this laptop.`}
        </p>
        <div className="mt-3 flex flex-col gap-1 border-t border-black/10 pt-2">
          <a className="rounded px-2 py-1 text-px-ink hover:bg-black/5" href="/settings">Settings</a>
          <button type="button" disabled={busy} onClick={() => void signOut(false)} className="rounded px-2 py-1 text-left text-red-700 hover:bg-black/5 disabled:opacity-60">
            {busy ? "Signing out…" : "Sign out"}
          </button>
          <button type="button" disabled={busy} onClick={() => void signOut(true)} className="rounded px-2 py-1 text-left text-xs text-red-700 hover:bg-black/5 disabled:opacity-60">
            Sign out and delete this laptop's copy
          </button>
        </div>
      </div>
    </details>
  );
}
