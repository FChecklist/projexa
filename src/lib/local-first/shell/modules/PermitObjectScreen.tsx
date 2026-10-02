"use client";

// LOCAL-FIRST shell, one permit: its details from the laptop's own copy, its PDF if kept here, and the two details that can be changed
// offline (name, end date: update_document_metadata). Permit number, issuing authority, issue date and notes need a connection (no
// registered function takes them; notes and tags are not synced at all).

import { permitStatus } from "@/components/permit-status";
import type { ShellScreenProps } from "../types";
import type { PermitObjectData } from "./permits-adapter";
import { DocumentDetailsEditor } from "./DocumentDetailsEditor";
import { CopyNote, DocumentFile, Facts, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, Waiting, dateText, projectQuery } from "./DocumentsShared";

const BACK = { href: "/permits", label: "Back to Permits" };

export default function PermitObjectScreen({ shell, data }: ShellScreenProps<PermitObjectData>) {
  if (data.state === "no_project") return <StateMessage testId="permit-object" state="no_project" title="Permit" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="permit-object" state="not_synced" title="Permit" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") return <StateMessage testId="permit-object" state="not_found" title="Permit" back={BACK}>This permit is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;

  const { permit, projectId } = data;
  return (
    <section data-testid="permit-object" data-state="local">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={`/permits${projectQuery(projectId)}`}>Permits</a></p>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="permit-title">{permit.name}<Waiting show={permit.waiting} /></h1>
      <p className="text-sm" data-testid="permit-status">{permitStatus(permit.daysToExpiry).label}</p>
      <CopyNote testId="permit-copy-note" syncedAt={data.syncedAt} />
      <Facts
        rows={[
          ["Permit number", permit.permitNumber ?? "-"],
          ["Issuing authority", permit.permitAuthority ?? "-"],
          ["Issue date", dateText(permit.issueDate)],
          ["End date", dateText(permit.endDate)],
        ]}
      />
      <DocumentFile shell={shell} source={{ module: "permits", docId: permit.id }} projectId={projectId} name={permit.name} external={permit.isExternalLink} />
      <DocumentDetailsEditor shell={shell} screen="permits" projectId={projectId} documentId={permit.id} initial={{ name: permit.name, category: permit.doc.category, expiryDate: permit.endDate }} />
      <OnlineOnly>The permit number, issuing authority, issue date and notes can be changed, and the permit deleted, when you are online.</OnlineOnly>
    </section>
  );
}
