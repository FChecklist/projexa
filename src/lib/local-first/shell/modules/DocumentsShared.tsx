"use client";

// LOCAL-FIRST shell, documents cluster: the pieces every screen of the cluster shares -- the calm state messages, the "saved on this
// laptop" line, the "waiting to sync" mark, and the FILE panel (documents-file-cache.ts: a kept copy offline, "Open the file" /
// "Keep on this laptop" online). Nothing here shows an error dialog for being offline.

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format-date";
import type { ShellApi } from "../types";
import { fetchDocumentFile, openFileCache, type FileSource, type KeptFile } from "./documents-file-cache";

export function StateMessage({ testId, state, title, back, children }: { testId: string; state: string; title: string; back?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section data-testid={testId} data-state={state}>
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      <p className="mt-3 text-sm text-px-muted">{children}</p>
      {back ? (
        <p className="mt-3 text-sm">
          <a className="text-px-ink underline underline-offset-2" href={back.href}>{back.label}</a>
        </p>
      ) : null}
    </section>
  );
}

export const NO_PROJECT = "There is no project on this laptop yet. Open PROJEXA once while you are online and your projects will be copied here.";
export const NOT_SYNCED = "This project has not finished copying to this laptop yet. It will appear here as soon as it has, while you are online.";

export function CopyNote({ testId, syncedAt }: { testId: string; syncedAt: number | null }) {
  return (
    <p className="mt-1 text-xs text-px-muted" data-testid={testId}>
      Saved on this laptop{syncedAt ? ` · last copied ${formatDateTime(syncedAt)}` : ""}
    </p>
  );
}

export function Waiting({ show }: { show: boolean }) {
  return show ? <span data-testid="doc-waiting" className="ml-2 rounded bg-px-concrete px-1.5 py-0.5 text-xs text-px-muted">Waiting to sync</span> : null;
}

/** A date the way the online lists show it, or a dash when the laptop has none. */
export function dateText(v: string | null): string {
  if (!v) return "-";
  const t = Date.parse(v);
  return Number.isFinite(t) ? formatDate(v) : v;
}

export function sizeText(bytes: number | null): string {
  if (bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const projectQuery = (projectId: string) => `?projectId=${encodeURIComponent(projectId)}`;

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-px-muted">{label}</dt>
          <dd className="text-px-ink" data-testid={`fact-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The plain "this needs a connection" line for the changes the laptop cannot make (no registered function behind them). */
export function OnlineOnly({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-xs text-px-muted" data-testid="doc-online-only">{children}</p>;
}

type FileState =
  | { s: "loading" }
  | { s: "kept"; file: KeptFile; url: string | null }
  | { s: "absent" }
  | { s: "external"; url: string }
  | { s: "message"; text: string };

function objectUrl(file: KeptFile): string | null {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([file.bytes], { type: file.type })) : null;
  } catch {
    return null;
  }
}

/**
 * The file behind a document. Offline: the kept copy, or a plain sentence that it was not kept. Online: "Open the file" (fetched once and
 * kept as a recent file) and "Keep on this laptop" (kept until removed). External links are links, never downloaded.
 */
export function DocumentFile({ shell, source, projectId, name, external }: { shell: ShellApi; source: FileSource; projectId: string; name: string; external: boolean }) {
  const [state, setState] = useState<FileState>({ s: "loading" });
  const [busy, setBusy] = useState(false);
  const orgId = shell.data.orgId ?? "";
  const online = shell.connectivity === "online";

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    (async () => {
      try {
        const cache = await openFileCache(shell.data.userId, { idb: shell.data.idb });
        try {
          const file = await cache.get(source.docId, { orgId, projectId });
          if (!alive) return;
          if (file) {
            url = objectUrl(file);
            setState({ s: "kept", file, url });
          } else setState({ s: "absent" });
        } finally {
          cache.close();
        }
      } catch {
        if (alive) setState({ s: "absent" });
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL?.(url);
    };
  }, [shell.data.userId, shell.data.idb, source.docId, orgId, projectId]);

  async function fetchAndKeep(pinned: boolean) {
    setBusy(true);
    try {
      const got = await fetchDocumentFile({ ...source, external });
      if (got.kind === "external") return setState({ s: "external", url: got.url });
      if (got.kind === "none") return setState({ s: "message", text: got.message });
      const cache = await openFileCache(shell.data.userId, { idb: shell.data.idb });
      try {
        const kept = await cache.put({ docId: source.docId, orgId, projectId, name, type: got.type, bytes: got.bytes, pinned });
        if (!kept.ok) return setState({ s: "message", text: kept.message });
        const file = await cache.get(source.docId, { orgId, projectId });
        setState(file ? { s: "kept", file, url: objectUrl(file) } : { s: "absent" });
      } finally {
        cache.close();
      }
    } finally {
      setBusy(false);
    }
  }

  async function setPinned(pinned: boolean) {
    const cache = await openFileCache(shell.data.userId, { idb: shell.data.idb });
    try {
      if (pinned) await cache.setPinned(source.docId, true);
      else await cache.remove(source.docId);
      const file = await cache.get(source.docId, { orgId, projectId });
      setState(file ? { s: "kept", file, url: state.s === "kept" ? state.url : objectUrl(file) } : { s: "absent" });
    } finally {
      cache.close();
    }
  }

  let body: ReactNode;
  if (state.s === "loading") body = <p className="text-sm text-px-muted">Looking for the file on this laptop...</p>;
  else if (state.s === "kept") {
    const { file, url } = state;
    body = (
      <div data-testid="doc-file-kept" data-pinned={file.pinned ? "1" : "0"}>
        <p className="text-sm text-px-ink">
          {file.pinned ? "Kept on this laptop." : "A recent copy is on this laptop (it may be dropped when space is needed)."} {file.name} · {sizeText(file.size)}
        </p>
        {url && file.type.startsWith("image/") ? <img className="mt-2 max-h-[480px] rounded border border-black/10" src={url} alt={file.name} /> : null}
        {url && file.type === "application/pdf" ? <iframe className="mt-2 h-[480px] w-full rounded border border-black/10" src={url} title={file.name} /> : null}
        {url ? <a className="mt-2 inline-block text-sm underline underline-offset-2" href={url} download={file.name}>Save a copy</a> : null}
        <div className="mt-2 flex gap-2">
          {file.pinned ? (
            <Button variant="outline" size="sm" data-testid="doc-file-remove" onClick={() => void setPinned(false)}>Remove from this laptop</Button>
          ) : (
            <Button variant="outline" size="sm" data-testid="doc-file-pin" onClick={() => void setPinned(true)}>Keep on this laptop</Button>
          )}
        </div>
      </div>
    );
  } else if (state.s === "external") {
    body = (
      <p className="text-sm" data-testid="doc-file-external">
        This is a link to another site: <a className="underline underline-offset-2" href={state.url} target="_blank" rel="noreferrer noopener">open it</a>.
      </p>
    );
  } else {
    body = (
      <div data-testid="doc-file-absent">
        {state.s === "message" ? <p className="text-sm text-px-muted" data-testid="doc-file-message">{state.text}</p> : null}
        {external ? (
          <p className="text-sm text-px-muted">This is a link to another site{online ? "." : "; it opens when you are online."}</p>
        ) : !online ? (
          <p className="text-sm text-px-muted">The file is not kept on this laptop. Open it here once while you are online, or choose &quot;Keep on this laptop&quot;, and it will be here next time.</p>
        ) : null}
        {online ? (
          <div className="mt-2 flex gap-2">
            <Button size="sm" data-testid="doc-file-open" disabled={busy} onClick={() => void fetchAndKeep(false)}>{external ? "Get the link" : "Open the file"}</Button>
            {!external ? <Button variant="outline" size="sm" data-testid="doc-file-keep" disabled={busy} onClick={() => void fetchAndKeep(true)}>Keep on this laptop</Button> : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-black/10 bg-white p-4" data-testid="doc-file">
      <h2 className="text-sm font-medium text-px-ink">File</h2>
      <div className="mt-2">{body}</div>
    </section>
  );
}
