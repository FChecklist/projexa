"use client";

// R67 F-22 (audit recommendation R-247) -- spend the dashboard's idle seconds.
//
// Scope and Work Progress are the two screens a site engineer opens most and
// the two slowest lists, and both are one click from here. The five seconds a
// user spends reading the dashboard are five seconds the network is doing
// nothing. This fills them, under every guard in prefetch-store.ts: only when
// the browser is idle, only on a connection worth spending (4g or unknown,
// never under Data Saver), at most two requests at a time, and dropped after
// 60 s so a stale copy can never be mistaken for a current one.
//
// Renders nothing. It is mounted from the dashboard's own view so the
// speculation lives and dies with that screen.
import { useEffect } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { DASHBOARD_SPECULATION_ROUTES, primaryListUrl } from "@/lib/module-prefetch";
import { onIdle, prefetch, shouldSpeculate } from "@/lib/prefetch-store";
import { readSelectedProjectId } from "@/lib/project-cookie";
import { useShell } from "@/lib/shell-store";

export function DashboardSpeculation({ fallbackProjectId }: { fallbackProjectId?: string | null }) {
  const shell = useShell();
  const shellLoaded = shell.loaded;

  useEffect(() => {
    // "After the last shell call resolves": speculation must never be the
    // thing competing with the shell's own bootstrap.
    if (!shellLoaded) return;
    if (!shouldSpeculate()) return;

    const projectId = readSelectedProjectId() ?? fallbackProjectId ?? null;
    if (!projectId) return;

    return onIdle(() => {
      for (const route of DASHBOARD_SPECULATION_ROUTES) {
        const url = primaryListUrl(route, projectId);
        if (url) prefetch(url, () => fetchJson<Record<string, unknown>>(url));
      }
    });
  }, [shellLoaded, fallbackProjectId]);

  return null;
}

export default DashboardSpeculation;
