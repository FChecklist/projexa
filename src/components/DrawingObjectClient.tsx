"use client";

// Real-screen conversion (2026-08-30): Drawings & 3D never had a detail view --
// rows only had a bare "Open" link. A drawing IS a `documents` row
// (category='drawing'|'drawing_3d', discipline in its metadata jsonb) -- the
// same underlying table the Documents module uses, reused here rather than
// duplicated.
//
// R67 D-11 (audit R-024/R-029). Two gaps on this one page, both closed here.
//
// EDIT existed nowhere: this file's own header used to say "No Edit:
// updateDocumentMetadata() doesn't accept a metadata/discipline patch ... an
// honest scope cut rather than a half-working edit form." The service accepts
// one now, so the page gets a real display -> edit toggle (object screens open
// read-only; Edit is explicit) with Save and Cancel.
//
// REMOVE was impossible for the person most likely to need it. The only
// destructive action was Dispose, whose reasons are derived from
// records-management fields, so a drawing uploaded a minute ago -- with a null
// disposalDate, because nobody had set a retention policy -- reported "No
// retention policy set" and its own uploader could not undo his own mistake.
// Inside the first 24 hours, with nothing referencing it, the drawing can now
// be REMOVED outright (the row and its file). Outside that window the
// retention-gated Dispose is unchanged, and every reason is written in the
// user's language rather than the schema's.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
// The fork (F-34 / D-09): the kit hard-codes this screen's destructive control
// as "Delete", and this page has two destructive acts that are genuinely
// different things -- so it takes the fork's `deleteLabel`. The fork also adds
// the `loading` variant. Not the kit's component; the kit is still imported for
// everything that was not forked, and A-21's ObjectContext is unaffected.
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import { DRAWING_OBJECT_BREADCRUMB } from "@/lib/object-breadcrumbs";
import { ObjectContext } from "@/components/shell/shell-screen-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";
import { setScreenMessage, takeScreenMessage } from "@/lib/screen-message";
import { normaliseDrawingStatus, statusPresentation, type DrawingStatus } from "@/lib/drawing-status";

export type Drawing = {
  id: string;
  name: string;
  kind: "dwg" | "3d_walkthrough";
  discipline: string | null;
  isExternalLink: boolean;
  documentUrl: string | null;
  createdAt: string;
  category: string | null;
  projectId: string | null;
  projectName: string | null;
  isDisposed: boolean;
  legalHold: boolean;
  disposalDate: string | null;
  /** Within the 24-hour grace window (computed by VERIDIAN, not from a string here). */
  isRecent: boolean;
  /** Later versions of this drawing, plus anything filed against it. */
  references: number;
  /** R67 D-12: the register's own identity and state. */
  drawingNo?: string | null;
  rev?: string | null;
  status?: string;
  /** The revision this one replaced, resolved by VERIDIAN in the same read. */
  supersedes?: { id: string; name: string; drawingNo: string | null; rev: string | null } | null;
};

/**
 * What a person calls this drawing. The register's own identifier wins over the
 * file name once there is one -- "AR-101 Rev B" is what a site engineer would
 * say, "AR-101 Ground floor plan_final(2).dwg" is what a file system would.
 */
export function drawingLabel(d: { name: string; drawingNo?: string | null; rev?: string | null }): string {
  if (!d.drawingNo) return d.name;
  return d.rev ? `${d.drawingNo} Rev ${d.rev}` : d.drawingNo;
}

/**
 * R67 D-12. The status tone the object header shows, mapped onto the four tones
 * that have a real --color-veri-status-* variable behind them. 'superseded' is
 * deliberately neutral: it is not a warning, it is simply not the build set.
 */
export function statusTone(status: DrawingStatus): "done" | "needs-you" | "neutral" {
  if (status === "current") return "done";
  if (status === "for_approval") return "needs-you";
  return "neutral";
}

export type DestructiveAction = { label: "Remove" | "Dispose"; disabledReason?: string };

/**
 * R67 D-11. The one destructive action this screen offers right now, and the
 * reason it is unavailable when it is -- in the user's language, not the
 * schema's. The ORDER is the point:
 *
 *  - a disposed drawing is already gone;
 *  - a legal hold outranks everything, including the grace window;
 *  - inside the grace window, with nothing referencing it, the uploader may
 *    still undo his own upload outright (this is the case the old screen made
 *    impossible);
 *  - outside it, the records-management rules take over, and each of their
 *    three states says what is true and who can act.
 */
export function destructiveAction(d: {
  isDisposed: boolean;
  legalHold: boolean;
  isRecent: boolean;
  references: number;
  disposalDate: string | null;
  today?: string;
}): DestructiveAction {
  const today = d.today ?? new Date().toISOString().slice(0, 10);
  if (d.isDisposed) return { label: "Dispose", disabledReason: "Already removed" };
  if (d.legalHold) return { label: "Remove", disabledReason: "On legal hold - cannot be removed" };
  if (d.isRecent) {
    if (d.references === 0) return { label: "Remove" };
    return {
      label: "Remove",
      disabledReason: `${d.references} other record${d.references === 1 ? "" : "s"} reference${d.references === 1 ? "s" : ""} this drawing`,
    };
  }
  if (!d.disposalDate) return { label: "Dispose", disabledReason: "Kept under the retention policy - ask an admin to dispose" };
  if (d.disposalDate > today) {
    return { label: "Dispose", disabledReason: `Kept until ${formatDate(d.disposalDate)} under the retention policy` };
  }
  return { label: "Dispose" };
}

/** The blast radius, stated: what goes, and why it is safe to say so. */
export function confirmText(action: DestructiveAction["label"], label: string, projectName: string | null): string {
  return action === "Remove"
    ? `Remove ${label} from ${projectName ?? "this project"}? Nothing else references it.`
    : `Dispose ${label}? Its file is destroyed and cannot be retrieved.`;
}

export default function DrawingObjectClient({ drawingId, projectId }: { drawingId: string; projectId: string }) {
  const router = useRouter();
  const [d, setD] = useState<Drawing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [acting, setActing] = useState(false);

  async function load() {
    try {
      const data = await fetchJson<Drawing>(`/api/drawings/${drawingId}`);
      setD(data);
      setName(data.name);
      setDiscipline(data.discipline ?? "");
      setLoadError(null);
    } catch (err) {
      setD(null);
      setLoadError(errorMessage(err, "Couldn't load this drawing"));
    }
  }

  useEffect(() => {
    load();
  }, [drawingId]);

  // R67 D-08: the receipt the create screen handed over ("Drawing <name>
  // added"), rendered in this screen's persistent message band rather than a
  // toast that is gone before the page finishes painting.
  useEffect(() => {
    const handed = takeScreenMessage("drawings.object");
    if (handed) setMessages([handed]);
  }, []);

  const backProjectId = d?.projectId ?? projectId;
  const backToList = () => router.push(backProjectId ? `/drawings?projectId=${backProjectId}` : "/drawings");

  async function handleSave() {
    if (!d || !name.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/drawings/${drawingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), discipline: discipline.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessages([{ level: "error", text: body.error ?? `Couldn't save this drawing (HTTP ${res.status})` }]);
        return;
      }
      setMessages([{ level: "success", text: "Saved" }]);
      setMode("display");
      await load();
    } catch (err) {
      setMessages([{ level: "error", text: errorMessage(err, "Couldn't save this drawing") }]);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (!d) return;
    setName(d.name);
    setDiscipline(d.discipline ?? "");
    setMessages([]);
    setMode("display");
  }

  async function runDestructive(action: DestructiveAction["label"], label: string) {
    if (!d || acting) return;
    setActing(true);
    try {
      // Remove is the grace-window hard delete (the row AND its file); Dispose
      // is the records-management act on the shared documents route, unchanged.
      const res =
        action === "Remove"
          ? await fetch(`/api/drawings/${drawingId}`, { method: "DELETE" })
          : await fetch(`/api/documents/${drawingId}/dispose`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessages([{ level: "error", text: body.error ?? `Couldn't ${action.toLowerCase()} this drawing (HTTP ${res.status})` }]);
        setConfirming(false);
        return;
      }
      // The receipt has to outlive this screen, which the push below replaces.
      setScreenMessage("drawings.list", {
        level: "success",
        text: `${label} ${action === "Remove" ? "removed" : "disposed"}`,
      });
      backToList();
    } catch (err) {
      setMessages([{ level: "error", text: errorMessage(err, `Couldn't ${action.toLowerCase()} this drawing`) }]);
      setConfirming(false);
    } finally {
      setActing(false);
    }
  }

  // R67 MERGE (lane D0's D-67 x lane D1's D-11). Lane D0 armed the kit's
  // single destructive control with useDeleteConfirmation, because the kit
  // called onDelete() straight from onClick and disposed a drawing AND its file
  // on one click with no confirmation anywhere. That rule is kept -- but this
  // screen has TWO destructive acts that mean different things ("Remove", the
  // grace-window hard delete, and "Dispose", the retention-gated records act),
  // and useDeleteConfirmation models one. The confirm above (confirmText() /
  // `confirming`) is therefore the one that survives: it states the same blast
  // radius, and it states the RIGHT one for whichever act is on offer.
  // useDeleteConfirmation is unchanged and still used by the other object pages.

  // "Loading" forever is its own lie. Once the load has failed, say so.
  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  // R67 F-34 (R-290): the SAME frame the route's own loading.tsx paints, so the
  // hand-over from the route skeleton to this client is invisible and the word
  // "Loading" is never alone on the screen. It says what it is waiting for after
  // 3 s and offers Retry at 8 s, D-04's abort budget.
  if (!d) return (
    <KitObjectScreen
      loading
      breadcrumb={DRAWING_OBJECT_BREADCRUMB.breadcrumb}
      label={DRAWING_OBJECT_BREADCRUMB.label}
      actions={DRAWING_OBJECT_BREADCRUMB.actions}
    />
  );

  const kind = d.kind === "3d_walkthrough" ? "3D Walkthrough" : "DWG";
  const label = drawingLabel(d);
  const status = normaliseDrawingStatus(d.status);
  const statusLook = statusPresentation(status);
  const action = destructiveAction(d);
  const editing = mode === "edit";

  return (
    <>
    {/* R67 A-21: "<project> › Drawing Ground floor plan rev C". This page takes
        its project from the QUERY STRING rather than from the record (the
        documents DTO carries no linkedEntityId, per the route's own comment),
        so an empty string is published as null -- the shell then falls back to
        the rail, which is honest, instead of resolving a project id of "". */}
    <ObjectContext moduleId="drawings" label={d.name} projectId={projectId || null} />
    <KitObjectScreen
      // Lane D0's shared constant, so this breadcrumb and the one the route's
      // own loading frame paints are the same literal and cannot drift.
      breadcrumb={DRAWING_OBJECT_BREADCRUMB.breadcrumb}
      // R67 D-12: what a person calls this drawing -- "AR-101 Rev B" -- not the
      // file name. `mode` is real here: D-11 gave the page an Edit toggle, and
      // D-11's own ruling is that object pages are display-first until Edit.
      title={label}
      subtitle={d.projectName ?? undefined}
      mode={mode}
      hasDraft={false}
      // R67 D-12: the register's own answer to "is this the one I build from?",
      // in the same words and the same glyph the list uses.
      headerStatus={{
        tone: d.isDisposed ? "late" : statusTone(status),
        label: d.isDisposed ? "removed" : `${statusLook.glyph} ${statusLook.word}`,
      }}
      facets={[
        { label: "Kind", value: kind },
        { label: "Rev", value: d.rev ?? "—" },
        { label: "Discipline", value: d.discipline ?? "—" },
        { label: "Added", value: formatDate(d.createdAt) },
        // A facet that named the revision this one replaced without going there
        // would make the reader search the register by hand.
        ...(d.supersedes
          ? [
              {
                label: "Supersedes",
                value: (
                  <Link
                    href={`/drawings/${d.supersedes.id}${backProjectId ? `?projectId=${backProjectId}` : ""}`}
                    className="underline underline-offset-2"
                  >
                    {drawingLabel(d.supersedes)}
                  </Link>
                ),
              },
            ]
          : []),
      ]}
      onEdit={!editing && !d.isDisposed ? () => setMode("edit") : undefined}
      onSave={editing ? handleSave : undefined}
      onCancel={editing ? handleCancel : undefined}
      saveDisabled={saving || !name.trim()}
      saveDisabledReason={saving ? "Saving…" : !name.trim() ? "Name is required" : undefined}
      // Display mode only, and arming the in-screen confirm rather than acting:
      // PROJEXA's one popup was removed by D-01 and none is coming back.
      onDelete={!editing ? () => setConfirming(true) : undefined}
      deleteLabel={action.label}
      deleteDisabledReason={action.disabledReason ?? (acting ? `${action.label}ing…` : undefined)}
      onBack={backToList}
      messages={messages}
    >
      <div className="space-y-4 px-4 py-3">
        {confirming && !editing && !action.disabledReason && (
          <section role="alertdialog" aria-label={`Confirm ${action.label.toLowerCase()}`} className="rounded-md border border-[color:var(--color-veri-status-late)] p-3">
            <p className="text-[13px] text-px-ink">{confirmText(action.label, label, d.projectName)}</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void runDestructive(action.label, label)}
                disabled={acting}
                className="rounded-md border border-[color:var(--color-veri-status-late)] px-3 py-1.5 text-[13px] text-[color:var(--color-veri-status-late)] disabled:opacity-50"
              >
                {acting ? `${action.label}ing…` : `${action.label} drawing`}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={acting}
                className="rounded-md border border-ct-border2 px-3 py-1.5 text-[13px] text-ct-navy disabled:opacity-50"
              >
                Keep drawing
              </button>
            </div>
          </section>
        )}

        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="drawing-name">Name</Label>
              <Input id="drawing-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drawing-discipline">Discipline (optional)</Label>
              <Input
                id="drawing-discipline"
                value={discipline}
                onChange={(e) => setDiscipline(e.target.value)}
                placeholder="Architectural, Structural, MEP..."
              />
            </div>
          </div>
        ) : d.documentUrl && !d.isDisposed ? (
          <a href={d.documentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] underline underline-offset-2">
            Open {kind === "3D Walkthrough" ? "walkthrough" : "drawing"}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : d.isDisposed ? (
          <p className="text-sm text-ct-muted">This drawing has been removed — the file is no longer retrievable.</p>
        ) : (
          <p className="text-sm text-ct-muted">No file link available.</p>
        )}
      </div>
    </KitObjectScreen>
    </>
  );
}
