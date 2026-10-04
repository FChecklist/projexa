"use client";

// LOCAL-FIRST shell, one Wiki page: title, version and content from the laptop's own copy. The online page offers no Edit either (it
// needs a per-user session), so there is nothing to hold back here. "Last edited by" is not synced and is not shown as "never".

import type { ShellScreenProps } from "../types";
import type { LocalWikiPage, ObjectData } from "./platform-adapter";
import { CopyNote, Facts, NOT_SYNCED, NO_PROJECT, StateMessage, projectQuery } from "./DocumentsShared";

const BACK = { href: "/wiki", label: "Back to the Wiki" };

export default function WikiObjectScreen({ data }: ShellScreenProps<ObjectData<LocalWikiPage>>) {
  if (data.state === "no_project") return <StateMessage testId="wiki-object" state="no_project" title="Wiki page" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="wiki-object" state="not_synced" title="Wiki page" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") {
    return <StateMessage testId="wiki-object" state="not_found" title="Wiki page" back={BACK}>This page is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;
  }
  const page = data.item;
  return (
    <section data-testid="wiki-object" data-state="local">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={`/wiki${projectQuery(data.projectId)}`}>Wiki</a></p>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="wiki-title">{page.title}</h1>
      <CopyNote testId="wiki-copy-note" syncedAt={data.syncedAt} />
      <Facts rows={[["Version", page.version === null ? "-" : String(page.version)]]} />
      <div className="mt-4 whitespace-pre-wrap rounded-md border border-black/10 bg-white p-4 text-sm text-px-ink" data-testid="wiki-content">
        {page.content ? page.content : <span className="text-px-muted">This page is empty.</span>}
      </div>
      <p className="mt-4 text-xs text-px-muted" data-testid="wiki-online-only">Who last edited this page is shown online.</p>
    </section>
  );
}
