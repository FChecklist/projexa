"use client";

// LOCAL-FIRST shell, overview cluster: keeps a screen's snapshots fresh WHILE THE LAPTOP IS ONLINE, and does nothing otherwise.
//
// A screen of this cluster draws from its adapter (the laptop's own database, snapshots included). This hook is the only place that
// talks to the server: when connectivity is "online" it fetches each named read from the SAME endpoint the online page uses
// (refreshSnapshot), keeps the answer, and asks the shell to run the adapter again so the screen shows it. Offline or with our server down
// it never fetches -- the screen keeps showing the last snapshot, labelled "As of ..., from this laptop".
//
// One try per (screen, reads, coming online): it does not poll. A refusal (403/404) has already removed the snapshot; the screen is
// redrawn so it no longer shows it.

import { useEffect, useRef, useState } from "react";
import { reportServerFailure, reportServerSuccess } from "../../connectivity";
import type { ShellApi } from "../types";
import { refreshSnapshot, snapshotCacheFor, snapshotKey, type RefreshOutcome, type SnapshotName } from "../snapshot-cache";

export type SnapshotRead = { name: SnapshotName; url: string; validate: (body: unknown) => boolean };

export type RefreshStatus = "idle" | "refreshing" | RefreshOutcome<unknown>["state"];

export function useSnapshotRefresh(shell: ShellApi, reads: readonly SnapshotRead[], options: { fetchImpl?: typeof fetch } = {}): RefreshStatus {
  const [status, setStatus] = useState<RefreshStatus>("idle");
  const online = shell.connectivity === "online";
  const signature = reads.map((r) => `${snapshotKey(r.name)}@${r.url}`).join("\n");
  const latest = useRef({ shell, reads, fetchImpl: options.fetchImpl });
  useEffect(() => {
    latest.current = { shell, reads, fetchImpl: options.fetchImpl };
  });

  useEffect(() => {
    if (!online || !signature) return;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      const { shell: s, reads: rs, fetchImpl } = latest.current;
      setStatus("refreshing");
      const cache = snapshotCacheFor({ userId: s.data.userId, role: s.data.role, idb: s.data.idb });
      const outcomes = await Promise.all(
        rs.map((r) => refreshSnapshot(cache, r.name, r.url, r.validate as (b: unknown) => b is unknown, { fetchImpl, signal: controller.signal }))
      );
      if (cancelled) return;
      const states = outcomes.map((o) => o.state);
      if (states.some((st) => st === "fresh" || st === "refused")) {
        reportServerSuccess();
        s.refresh();
      } else if (states.some((st) => st === "offline" || st === "server")) {
        reportServerFailure();
      }
      // The least good outcome is the one worth saying.
      const order: RefreshStatus[] = ["refused", "signed_out", "server", "offline", "invalid", "fresh"];
      setStatus(order.find((o) => states.includes(o as never)) ?? "fresh");
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [online, signature]);

  return online ? status : "idle";
}

/** Plain words for a refresh status, or null when there is nothing to say. */
export function refreshNote(status: RefreshStatus, hasSnapshot: boolean): string | null {
  switch (status) {
    case "refreshing":
      return hasSnapshot ? "Checking the server for newer figures…" : "Fetching the figures from the server…";
    case "server":
    case "offline":
      return hasSnapshot ? "The server is not answering just now, so these are the figures last saved on this laptop." : "The server is not answering just now. The figures will appear once it does.";
    case "signed_out":
      return "Sign in again to bring these figures up to date.";
    case "refused":
      return "The server no longer shows you these figures.";
    case "invalid":
      return "The server's answer could not be read, so the last saved figures are shown.";
    default:
      return null;
  }
}
