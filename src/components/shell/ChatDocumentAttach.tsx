"use client";

// PROJEXA-BUILD-002 WP-10, way 2: attach a file in the chat. The composer's attach control (DropZone) takes a workbook and routes it to the
// SAME "make a project from a file" flow as the upload screen (use-document-job.ts, POST /api/projects/from-document), and shows what came
// back in the chat: the progress and the result panel in the composer, and a saved message with a link in the shell's message region above
// it when the project is created.
//
// WHERE IT APPEARS. The composer's attach slot is filled by a module's own attach policy on the screens that declare one (Documents,
// Permits, Drawings, Scope: src/lib/card-catalogue.ts); those keep their behaviour. On every other screen the slot was empty, and this
// control fills it, so the chat takes a project file anywhere. M24Shell decides which of the two is mounted.
//
// A FILE HERE MAKES A NEW PROJECT. PROJEXA has no product choice: the server files it under the organisation's PROJEXA product. Nothing is
// created until the person confirms, exactly as on the upload screen. Role: every role except client_viewer sees the control.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DropZone, type AttachedFile } from "@/components/shell/DropZone";
import { DocumentJobPanel } from "@/components/upload/DocumentJobPanel";
import { useDocumentJob } from "@/hooks/use-document-job";
import { canSendProjectDocument } from "@/lib/project-document-access";
import { checkDocumentFile, DOCUMENT_POLICY, type FromDocumentClient } from "@/lib/project-from-document-client";
import { useShellMessages } from "@/lib/shell-messages";

const projectHref = (projectId: string) => `/dashboard/project?projectId=${encodeURIComponent(projectId)}`;

export function ChatDocumentAttach({
  role,
  client,
  disabled = false,
  timing,
}: {
  role: string | null | undefined;
  client: FromDocumentClient;
  disabled?: boolean;
  timing?: { intervalMs?: number; timeoutMs?: number };
}) {
  const job = useDocumentJob(client, timing);
  const messages = useShellMessages();
  const [attached, setAttached] = useState<AttachedFile | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const announced = useRef<string | null>(null);

  const created = job.phase.kind === "created" ? job.phase : null;
  useEffect(() => {
    if (!created || announced.current === created.projectId) return;
    announced.current = created.projectId;
    messages.push({
      kind: "saved",
      text: created.duplicate ? `${created.fileName} already made a project` : `Project created from ${created.fileName}`,
      href: projectHref(created.projectId),
      linkLabel: "Open the project",
    });
  }, [created, messages]);

  if (!canSendProjectDocument(role)) return null;

  function onAdd(incoming: File[]) {
    const picked = incoming[0];
    if (!picked) return;
    job.reset();
    const error = checkDocumentFile(picked);
    setFile(error ? null : picked);
    setAttached({ id: "chat-doc", name: picked.name, size: picked.size, status: error ? "error" : "ready", progress: 0, error: error ?? undefined });
  }

  function onRemove() {
    job.reset();
    setFile(null);
    setAttached(null);
  }

  const canRead = file !== null && !job.busy;

  return (
    <div className="flex flex-col gap-2" data-testid="chat-document-attach">
      <DropZone policy={DOCUMENT_POLICY} files={attached ? [attached] : []} onAdd={onAdd} onRemove={onRemove} disabled={disabled || job.busy} />
      {file && job.phase.kind === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="veri-view-tab self-start" style={{ minHeight: 32 }} disabled={!canRead} onClick={() => void job.start({ file })} data-testid="chat-doc-read">
            Read the file
          </button>
        </div>
      )}
      <DocumentJobPanel
        phase={job.phase}
        onCreate={(choice) => void job.finish(choice)}
        onReset={onRemove}
        onAcceptShortfall={file ? () => void job.start({ file, acknowledgeShortfall: true }) : undefined}
        projectHref={projectHref}
      />
      {job.phase.kind === "parked" && (
        <Link className="text-[12px] underline" href={`/projects/from-file?job=${job.sha256 ?? ""}`}>Open it on its own screen</Link>
      )}
    </div>
  );
}
