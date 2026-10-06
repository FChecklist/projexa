"use client";

// LOCAL-FIRST shell: the files waiting on this laptop (G-15), and what happened to the ones that could not be sent, in plain words.
// Shown on the new-permit / new-drawing / new-document screens and under the three lists, so a person who added a file offline sees it is not lost.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { FileJob, FileJobKind, FileNotice } from "../file-queue";
import type { ShellApi } from "../types";
import { FILE_KIND_WORDS } from "./file-writes";

const sizeWord = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** `tick` is anything that changes when the shell redraws the screen (the screen's data), so the list is read again after an add or a flush. */
export function FilesWaiting({ shell, kinds, projectId, tick }: { shell: ShellApi; kinds: readonly FileJobKind[]; projectId: string | null; tick?: unknown }) {
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const [notices, setNotices] = useState<FileNotice[]>([]);

  useEffect(() => {
    let live = true;
    void Promise.all([shell.files.list(), shell.files.notices()])
      .then(([j, n]) => {
        if (!live) return;
        setJobs(j.filter((x) => kinds.includes(x.kind) && (x.kind === "document" || x.projectId === projectId)));
        setNotices(n);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.files, tick, projectId, kinds.join(",")]);

  if (jobs.length === 0 && notices.length === 0) return null;
  return (
    <div className="mt-4 max-w-xl" data-testid="files-waiting">
      {jobs.length > 0 ? (
        <ul className="rounded-lg border border-black/10 bg-white p-3 text-sm" data-testid="files-waiting-list">
          {jobs.map((j) => (
            <li key={j.id} data-testid="files-waiting-item" data-state={j.state} className="py-1">
              <span className="font-medium">{String(j.fields.name ?? j.fileName)}</span>
              <span className="text-px-muted"> · {FILE_KIND_WORDS[j.kind].one} · {j.fileName} ({sizeWord(j.size)}) · </span>
              <span>{j.state === "uploaded" ? "File sent, adding the record" : "File waiting to upload"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {notices.map((n) => (
        <p key={n.id} role="alert" className="mt-2 rounded-lg border border-black/10 bg-white p-3 text-sm text-px-ink" data-testid="files-notice">
          {n.message}{" "}
          <Button type="button" size="sm" variant="outline" onClick={() => void shell.files.dismissNotice(n.id).then(() => setNotices((cur) => cur.filter((x) => x.id !== n.id)))}>Dismiss</Button>
        </p>
      ))}
    </div>
  );
}
