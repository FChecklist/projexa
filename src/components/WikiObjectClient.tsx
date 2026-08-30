"use client";

// Real-screen conversion (2026-08-30): replaces WikiClient.tsx's old inline
// "selected page" panel (a Card toggled by local state, not a real URL) with
// a real Object Page. getWikiPage() didn't exist before -- only the
// project-wide list did.
//
// Also corrects a stale claim: the old honest-disclosure banner said BOTH
// "New Page and Save will be rejected" without a real user session. That was
// only ever half true -- createWikiPage() was already fixed (its own header
// comment: "same isRealUser gate as knowledge-base-service.ts's
// createKbPage()") to accept the shared API-key path, degrading to a null
// updatedById rather than rejecting. Confirmed live against this repo's
// actual Postgres schema (pms_wiki_pages_updated_by_id_fkey really does
// reference compliance.users(id) -- checked before assuming either way,
// since the sibling Vendor Master tables turned out to have NO such FK
// despite looking the same in schema.ts) that only Edit (updateWikiPage())
// is genuinely blocked -- it unconditionally sets updatedById to the actor,
// which would violate that real FK for a non-dbUser caller, and the route
// itself already 400s API-key callers rather than let that happen. So this
// Object Page has no onEdit at all (same "honestly omit, don't disable"
// convention Site Diary used this session for its own no-Edit constraint);
// Create is a real, working screen (WikiCreateClient.tsx).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type WikiPage = { id: string; projectId: string; slug: string; title: string; content: string | null; version: number; updatedById: string | null };

export default function WikiObjectClient({ pageId }: { pageId: string }) {
  const router = useRouter();
  const [page, setPage] = useState<WikiPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchJson<WikiPage>(`/api/wiki/${pageId}`);
      setPage(data);
      setLoadError(null);
    } catch (err) {
      setPage(null);
      setLoadError(errorMessage(err, "Couldn't load this wiki page"));
    }
  }
  useEffect(() => { load(); }, [pageId]);

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!page) return <p className="p-6 text-[13px] text-px-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Wiki / Page"
      title={page.title}
      mode="display"
      hasDraft={false}
      facets={[
        { label: "Version", value: String(page.version) },
        { label: "Last edited by", value: page.updatedById ? "a real user" : "never edited by a real user" },
      ]}
      onBack={() => router.push(`/wiki?projectId=${page.projectId}`)}
      messages={[{
        level: "info",
        text: "Editing this page requires a per-user VERIDIAN session. PROJEXA's connection to VERIDIAN currently authenticates with a shared organization API key, not individual logins, so Edit is not offered here until that per-user identity bridge exists. Creating new pages is unaffected.",
      }]}
    >
      <div className="px-4 py-3">
        <div className="whitespace-pre-wrap rounded-md border border-px-border bg-white p-4 text-sm text-px-ink">
          {page.content || <span className="text-px-muted">This page is empty.</span>}
        </div>
      </div>
    </ObjectScreen>
  );
}
