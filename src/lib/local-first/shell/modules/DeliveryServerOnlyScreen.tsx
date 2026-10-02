"use client";

// LOCAL-FIRST shell, cluster "delivery": a create/import screen that only the server can do today (/labour/new, /labour/import,
// /materials/new, /schedule/tasks/new). It is registered ONLY because those paths would otherwise be taken by an object route
// (/labour/:id would read "new" as a worker id). It behaves exactly like the shell's own "not on this laptop" fallback
// (LocalShell.tsx NotInShell): online it opens the server's page, offline it says so calmly.

import { serverPageUrl } from "../paths";
import type { ShellScreenProps } from "../types";
import { useServerRedirect } from "../server-redirect";

export type ServerOnlyData = { path: string; what: string };

export default function DeliveryServerOnlyScreen({ shell, query, data }: ShellScreenProps<ServerOnlyData>) {
  const online = shell.connectivity === "online";
  const search = query.toString();
  const url = serverPageUrl({ path: data.path, search: search ? `?${search}` : "" });
  useServerRedirect(online, url);
  return (
    <section data-testid="delivery-server-only" data-online={online ? "1" : "0"}>
      <h1 className="font-heading text-2xl text-px-ink">{data.what}</h1>
      <p className="mt-3 text-sm text-px-muted">
        {online ? "Opening this screen from the server…" : `${data.what} is done on the server for now. It will open when you are connected.`}
      </p>
    </section>
  );
}
