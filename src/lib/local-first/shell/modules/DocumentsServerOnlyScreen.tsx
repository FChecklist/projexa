"use client";

// LOCAL-FIRST shell, documents cluster: the create screens (/permits/new, /drawings/new, /documents/upload, /moms/new). They are
// registered only so that "/permits/new" is not mistaken for a permit whose id is "new" by the "/permits/:id" route. They behave exactly
// like a path the shell does not have (LocalShell's NotInShell): online, the server's page opens; offline, a calm sentence says why the
// screen needs a connection (it uploads a file, or needs data the laptop does not hold).

import { useEffect } from "react";
import { serverPageUrl } from "../paths";
import type { ShellScreenProps } from "../types";

/** What the route's adapter (clusters/documents.ts) hands over: the path and query as asked for, never anything from the database. */
export type ServerOnlyData = { path: string; search: string; title: string; reason: string };

export default function DocumentsServerOnlyScreen({ shell, data }: ShellScreenProps<ServerOnlyData>) {
  const online = shell.connectivity === "online";
  const serverUrl = serverPageUrl({ path: data.path, search: data.search });
  useEffect(() => {
    if (online) window.location.replace(serverUrl);
  }, [online, serverUrl]);
  return (
    <section data-testid="documents-server-only" data-online={online ? "1" : "0"}>
      <h1 className="font-heading text-2xl text-px-ink">{data.title}</h1>
      <p className="mt-3 text-sm text-px-muted">{online ? "Opening this screen from the server…" : `${data.reason} It will open when you are connected.`}</p>
      <p className="mt-3 text-sm">
        {online ? <a className="text-px-ink underline underline-offset-2" href={serverUrl}>Open it now</a> : null}
      </p>
    </section>
  );
}
