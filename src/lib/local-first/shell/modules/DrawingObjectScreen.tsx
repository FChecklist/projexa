"use client";

// LOCAL-FIRST shell, one drawing: its register details, what it supersedes, its revision history (derived from the register on this
// laptop, see drawings-adapter.ts), its file if kept here, and a rename (update_document_metadata). Discipline, status and revision
// changes, remove and dispose need a connection (no registered function takes them).

import { statusText } from "@/lib/drawing-status";
import type { ShellScreenProps } from "../types";
import type { DrawingObjectData } from "./drawings-adapter";
import { DocumentDetailsEditor } from "./DocumentDetailsEditor";
import { CopyNote, DocumentFile, Facts, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, Waiting, dateText, projectQuery } from "./DocumentsShared";

const BACK = { href: "/drawings", label: "Back to Drawings" };

export default function DrawingObjectScreen({ shell, data }: ShellScreenProps<DrawingObjectData>) {
  if (data.state === "no_project") return <StateMessage testId="drawing-object" state="no_project" title="Drawing" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="drawing-object" state="not_synced" title="Drawing" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") return <StateMessage testId="drawing-object" state="not_found" title="Drawing" back={BACK}>This drawing is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;

  const { drawing, projectId, supersedes } = data;
  const q = projectQuery(projectId);
  return (
    <section data-testid="drawing-object" data-state="local">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={`/drawings${q}`}>Drawings &amp; 3D</a></p>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="drawing-title">{drawing.name}<Waiting show={drawing.waiting} /></h1>
      <p className="text-sm" data-testid="drawing-status">{statusText(drawing.status)}</p>
      <CopyNote testId="drawing-copy-note" syncedAt={data.syncedAt} />
      <Facts
        rows={[
          ["Drawing No.", drawing.meta.drawingNo ?? "-"],
          ["Rev", drawing.meta.rev ?? "-"],
          ["Kind", drawing.kindLabel],
          ["Discipline", drawing.meta.discipline ?? "-"],
          ["Added", dateText(drawing.createdAt)],
          [
            "Supersedes",
            supersedes ? (
              <a className="underline underline-offset-2" href={`/drawings/${encodeURIComponent(supersedes.id)}${q}`}>{supersedes.name}{supersedes.meta.rev ? ` (rev ${supersedes.meta.rev})` : ""}</a>
            ) : drawing.meta.supersedesId ? "A revision that is not on this laptop" : "-",
          ],
        ]}
      />
      {data.history.length > 1 ? (
        <div className="mt-4 text-sm" data-testid="drawing-history">
          <p className="text-px-muted">Revision history (on this laptop)</p>
          <ol className="mt-1 list-decimal pl-5">
            {data.history.map((d) => (
              <li key={d.id} data-testid="drawing-history-item" data-doc-id={d.id}>
                {d.id === drawing.id ? <strong>{d.meta.rev ? `Rev ${d.meta.rev}` : d.name}</strong> : <a className="underline underline-offset-2" href={`/drawings/${encodeURIComponent(d.id)}${q}`}>{d.meta.rev ? `Rev ${d.meta.rev}` : d.name}</a>}{" "}
                · {statusText(d.status)} · {dateText(d.createdAt)}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <DocumentFile shell={shell} source={{ module: "drawings", docId: drawing.id }} projectId={projectId} name={drawing.name} external={drawing.isExternalLink} />
      <DocumentDetailsEditor shell={shell} screen="drawings" projectId={projectId} documentId={drawing.id} initial={{ name: drawing.name, category: drawing.category, expiryDate: drawing.expiryDate }} />
      <OnlineOnly>Changing the discipline, status or revision, removing or disposing of a drawing need a connection.</OnlineOnly>
    </section>
  );
}
