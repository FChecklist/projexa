"use client";

// LOCAL-FIRST shell, cluster "design and change": a screen that stays on the server. Today that is the Design Studio Cost analysis
// (/design-studio/cost-analysis): Budget | Actual | Variance from the server's designerTimesheetReport -- money, built from hourly rates
// and budgets the laptop does not hold, and never computed on the laptop. Online, the server's page opens; offline, one calm sentence
// says why it needs a connection. Behaves like the shell's own "not on this laptop" fallback.

import { useEffect } from "react";
import { serverPageUrl } from "../paths";
import type { ShellScreenProps } from "../types";

/** What the route's adapter hands over: the path and query as asked for, never anything from the database. */
export type DesignChangeServerOnlyData = { path: string; search: string; title: string; reason: string };

export default function DesignChangeServerOnlyScreen({ shell, data }: ShellScreenProps<DesignChangeServerOnlyData>) {
  const online = shell.connectivity === "online";
  const serverUrl = serverPageUrl({ path: data.path, search: data.search });
  useEffect(() => {
    if (online) window.location.replace(serverUrl);
  }, [online, serverUrl]);
  return (
    <section data-testid="dc-server-only" data-online={online ? "1" : "0"}>
      <h1 className="font-heading text-2xl text-px-ink">{data.title}</h1>
      <p className="mt-3 text-sm text-px-muted">{online ? "Opening this screen from the server…" : `${data.reason} It will open when you are connected.`}</p>
      {online ? (
        <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={serverUrl}>Open it now</a></p>
      ) : null}
    </section>
  );
}
