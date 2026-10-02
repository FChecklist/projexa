"use client";

// LOCAL-FIRST shell, one document: its details from the laptop's own copy, its file if kept on this laptop (DocumentFile), and the
// details a person may change offline (name, category, expiry: update_document_metadata). A new version (file upload), dispose and
// "Relates to" need a connection.

import type { ShellScreenProps } from "../types";
import type { DocumentObjectData } from "./documents-adapter";
import { DocumentDetailsEditor } from "./DocumentDetailsEditor";
import { CopyNote, DocumentFile, Facts, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, Waiting, dateText, projectQuery, sizeText } from "./DocumentsShared";

const BACK = { href: "/documents", label: "Back to Documents" };

export default function DocumentObjectScreen({ shell, data }: ShellScreenProps<DocumentObjectData>) {
  if (data.state === "no_project") return <StateMessage testId="document-object" state="no_project" title="Document" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="document-object" state="not_synced" title="Document" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") return <StateMessage testId="document-object" state="not_found" title="Document" back={BACK}>This document is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;

  const { doc, projectId } = data;
  return (
    <section data-testid="document-object" data-state="local">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={`/documents${projectQuery(projectId)}`}>Documents</a></p>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="document-title">{doc.name}<Waiting show={doc.waiting} /></h1>
      {doc.versionNumber !== null ? <p className="text-sm text-px-muted">Version {doc.versionNumber}{doc.isLatestVersion === false ? " (a newer version exists)" : ""}</p> : null}
      <CopyNote testId="document-copy-note" syncedAt={data.syncedAt} />
      <Facts
        rows={[
          ["Category", doc.category ?? "-"],
          ["Type", doc.fileType ?? "-"],
          ["Size", sizeText(doc.fileSize)],
          ["Expiry", dateText(doc.expiryDate)],
          ["Added", dateText(doc.createdAt)],
        ]}
      />
      {data.sameName.length > 0 ? (
        <div className="mt-4 text-sm" data-testid="document-versions">
          <p className="text-px-muted">Other documents with this name on this laptop:</p>
          <ul className="mt-1 list-disc pl-5">
            {data.sameName.map((d) => (
              <li key={d.id}>
                <a className="underline underline-offset-2" href={`/documents/${encodeURIComponent(d.id)}${projectQuery(projectId)}`}>
                  {d.versionNumber !== null ? `v${d.versionNumber}` : d.name}
                </a>{" "}
                ({dateText(d.createdAt)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <DocumentFile shell={shell} source={{ module: "documents", docId: doc.id }} projectId={projectId} name={doc.name} external={doc.isExternalLink} />
      <DocumentDetailsEditor shell={shell} screen="documents" projectId={projectId} documentId={doc.id} initial={{ name: doc.name, category: doc.category, expiryDate: doc.expiryDate }} />
      <OnlineOnly>Uploading a new version, disposing of this document and &quot;Relates to&quot; need a connection.</OnlineOnly>
    </section>
  );
}
