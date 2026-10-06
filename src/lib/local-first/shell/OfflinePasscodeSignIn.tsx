"use client";

// LOCAL-FIRST, AUDIT-100 B20: the offline passcode sign-in, on the shell's signed-out screen. With no network the service worker opens the shell
// from the laptop's kept release for ANY address (/login included, sw-core.ts), so this is the sign-in form a signed-out person reaches offline.
// It is the same check as the online login page's offline branch (src/app/login/page.tsx): the salted hash kept at the last online sign-in
// (offline-pin.ts) is compared on the laptop; nothing is sent anywhere. A wrong passcode is refused in plain words; the right one re-creates the
// person's identity on this laptop and opens their own local copy.

import { useState } from "react";
import { openDeviceMeta } from "../device-meta";
import { createIdentityStore } from "../identity";
import { unlockOffline } from "../offline-pin";

export function OfflinePasscodeSignIn({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const identityStore = createIdentityStore({ storage: window.localStorage, openMeta: () => openDeviceMeta() });
      const result = await unlockOffline({ storage: window.localStorage, identityStore }, email, password);
      if (!result.ok) {
        setError(result.notice);
        setBusy(false);
        return;
      }
      window.location.assign(next);
    } catch {
      setError("This laptop could not check the passcode. Try again.");
      setBusy(false);
    }
  }

  return (
    <form data-testid="local-shell-offline-signin" onSubmit={submit} className="mt-6 space-y-3 text-left">
      <label className="block text-sm text-px-ink" htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border border-px-line px-3 py-2 text-sm" />
      <label className="block text-sm text-px-ink" htmlFor="password">Passcode</label>
      <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border border-px-line px-3 py-2 text-sm" />
      {error ? <p role="alert" data-testid="local-shell-offline-signin-error" className="text-sm text-red-700">{error}</p> : null}
      <button type="submit" disabled={busy} className="w-full rounded bg-px-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
        {busy ? "Checking…" : "Sign in on this laptop"}
      </button>
    </form>
  );
}
