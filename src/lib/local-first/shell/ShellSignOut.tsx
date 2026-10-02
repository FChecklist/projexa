"use client";

// LOCAL-FIRST shell: the person's way to sign out of the on-laptop app (package lf-e12, found in a real browser).
//
// Once a release is installed, EVERY app page is this shell (sw-core.ts navigation), and its header only printed the person's email: no
// account menu, no sign-out. The only way out was the Settings page, which the shell does not have and opens from the server -- online
// only, and only for someone who knows to go there. These are the same two choices as the app's own AccountMenu (CONTRACT "sign-out
// policy"): "Sign Out" keeps this laptop's copy; "Sign out and delete this laptop's copy" removes it. Both go through signOutEverywhere,
// which flushes pending edits first, never destroys work silently, and ends the session by hand when the server cannot be reached
// (so it works offline too). When it has something to say (edits kept, a delete that could not complete), the words stay on screen
// with a link to the sign-in page, instead of vanishing with a navigation.

import { useState } from "react";
import { SIGN_OUT_AND_DELETE_LABEL } from "../sign-out-everywhere";

export type ShellSignOutAction = (deleteLocalCopy: boolean) => Promise<{ notice: string | null }>;

/** The real sign-out: the same steps as components/shell/AccountMenu.tsx, loaded only when the person clicks. */
export const realShellSignOut: ShellSignOutAction = async (deleteLocalCopy) => {
  const [{ createClient }, { rememberSelectedProject }, { clearBoqDeviceCopiesOnSignOut }, { signOutEverywhere }] = await Promise.all([
    import("@/lib/supabase/client"),
    import("@/lib/project-cookie"),
    import("@/lib/boq-line-cache"),
    import("../sign-out-everywhere"),
  ]);
  rememberSelectedProject(null);
  await clearBoqDeviceCopiesOnSignOut().catch(() => {});
  const { notice } = await signOutEverywhere({ auth: createClient().auth, deleteLocalCopy });
  return { notice };
};

export function ShellSignOut({ signOut = realShellSignOut, goToLogin = () => window.location.assign("/login") }: { signOut?: ShellSignOutAction; goToLogin?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(deleteLocalCopy: boolean) {
    setBusy(true);
    let said: string | null = null;
    try {
      said = (await signOut(deleteLocalCopy)).notice;
    } catch {
      said = null; // signOutEverywhere never throws; a failed import still leaves the person to the sign-in page
    }
    if (said) {
      setNotice(said);
      setBusy(false);
      return;
    }
    goToLogin();
  }

  if (notice) {
    return (
      <span data-testid="local-shell-signed-out-notice" className="flex items-center gap-2">
        <span role="status" className="text-px-ink">{notice}</span>
        <a className="underline underline-offset-2" href="/login">Sign in</a>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button type="button" data-testid="local-shell-sign-out" disabled={busy} onClick={() => void run(false)} className="underline-offset-2 hover:underline disabled:opacity-50">
        {busy ? "Signing out…" : "Sign Out"}
      </button>
      <button type="button" data-testid="local-shell-sign-out-delete" disabled={busy} onClick={() => void run(true)} className="underline-offset-2 hover:underline disabled:opacity-50">
        {SIGN_OUT_AND_DELETE_LABEL}
      </button>
    </span>
  );
}
