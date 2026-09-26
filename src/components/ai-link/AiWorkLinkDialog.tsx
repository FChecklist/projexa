"use client";

// PROJEXA-BUILD-002 WP-08 (AW-405, AW-406). The AI work link dialog. Two modes of one dialog:
//   "project"      a person opens a project, reads the warning, picks the level and the days, presses Create, gets the link once, and sees
//                  (and can revoke) the links they already made for this project.
//   "new-project"  "New project with my AI": one press makes an empty shell project and a read-and-draft link to it for the same person.
//
// THE WARNING COMES FROM THE DATABASE. The sentence is fetched from the service for the chosen level and shown as it arrives; nothing on
// this screen rewrites or hard-codes it, because the database knows the true counts and whether direct entries are switched on. Create
// stays disabled until the sentence for the CURRENT level is on screen, and a failed fetch shows an error and no Create button. (A new
// project does not exist yet, so its warning cannot be asked for beforehand: it is fetched for the new project right after and shown
// beside the link.)
//
// THE LINK IS SHOWN ONCE. The token lives only in this component's state. Closing the dialog unmounts that state, so a second open starts
// clean. It is never written to storage, the URL, a log or analytics (see ai-work-link-client.ts), and while it is on screen a click
// outside the dialog does not close it (Escape and the Done button still do), so it is not lost by a stray click.
//
// ONE LINK PER PERSON AND PROJECT. Making a new link switches off the earlier one for the same person and project, and the dialog says so.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format-date";
import { AWL_DAYS, AwlError, type AwlClient, type AwlDays, type AwlLevel, type AwlLinkRow, type AwlMinted, type AwlWarning } from "@/lib/ai-work-link-client";

export type AiLinkProject = { id: string; name: string };

export const LEVEL_LABEL: Record<AwlLevel, string> = { 0: "Read and draft", 1: "Direct entries" };

function messageOf(error: unknown): string {
  if (error instanceof AwlError) return error.message;
  return "Something went wrong. Nothing was changed. Try again in a minute.";
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  // The app's fixed-locale formatter (UTC), so the server and the browser print the same text; the zone is named so it is not misread.
  return Number.isNaN(new Date(iso).getTime()) ? iso : `${formatDateTime(iso)} UTC`;
}

type Announcer = (text: string) => void;

// ---- small shared pieces ----

function DaysPicker({ value, onChange, disabled }: { value: AwlDays; onChange: (days: AwlDays) => void; disabled?: boolean }) {
  const name = useId();
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-sm font-medium">How long the link works</legend>
      <div className="flex flex-wrap gap-4">
        {AWL_DAYS.map((d) => (
          <label key={d} className="flex items-center gap-2 text-sm">
            <input type="radio" name={name} checked={value === d} onChange={() => onChange(d)} />
            {d === 1 ? "1 day" : `${d} days`}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ResultPanel({ minted, projectName, warning, announce }: { minted: AwlMinted; projectName: string; warning: AwlWarning | null; announce: Announcer }) {
  const linkId = useId();
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      announce(`${what} copied.`);
    } catch {
      announce(`Could not copy the ${what.toLowerCase()}. Select it and copy it by hand.`);
    }
  }
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3" data-testid="awl-result">
      <p className="text-sm font-medium">{minted.shell ? `Your new project ${projectName} and its link are ready.` : "Your link is ready."}</p>
      <p className="text-sm text-muted-foreground">{minted.notice}</p>
      <div className="space-y-1.5">
        <label htmlFor={linkId} className="text-sm font-medium">Your AI work link</label>
        <div className="flex gap-2">
          <Input id={linkId} readOnly value={minted.link} onFocus={(e) => e.currentTarget.select()} data-testid="awl-link" />
          <Button type="button" variant="outline" onClick={() => void copy(minted.link, "Link")} data-testid="awl-copy">
            <Copy className="size-3.5" /> Copy link
          </Button>
        </div>
      </div>
      {minted.inbox && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>Inbox link, for confirming drafts</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void copy(minted.inbox as string, "Inbox link")}>
            <Copy className="size-3.5" /> Copy inbox link
          </Button>
        </div>
      )}
      <p className="text-sm" data-testid="awl-instruction">
        Paste this link into your AI assistant and ask it to read the link and help you with {projectName}. Use an assistant that only you use, and do not
        share the link. It stops working on {formatWhen(minted.expiresAt) || "its expiry date"}, or when you revoke it.
      </p>
      {warning && (
        <p className="text-sm text-muted-foreground" data-testid="awl-result-warning">
          {warning.sentence}
        </p>
      )}
    </div>
  );
}

// ---- mode "project" ----

type WarningState = { kind: "loading" } | { kind: "ready"; warning: AwlWarning } | { kind: "error"; message: string };
type LinksState = { kind: "loading" } | { kind: "ready"; rows: AwlLinkRow[] } | { kind: "error"; message: string };

function ProjectBody({ project, client, onSecretChange, onClose, announce }: { project: AiLinkProject; client: AwlClient; onSecretChange: (shown: boolean) => void; onClose: () => void; announce: Announcer }) {
  const [level, setLevel] = useState<AwlLevel>(0);
  const [days, setDays] = useState<AwlDays>(7);
  const [label, setLabel] = useState("");
  const [warning, setWarning] = useState<WarningState>({ kind: "loading" });
  const [known, setKnown] = useState<AwlWarning | null>(null);
  const [warningTry, setWarningTry] = useState(0);
  const [minted, setMinted] = useState<AwlMinted | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<LinksState>({ kind: "loading" });
  const [revoking, setRevoking] = useState<string | null>(null);
  const alive = useRef(true);
  const labelId = useId();
  const levelName = useId();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The sentence for the chosen level. A late answer for a level the person has already left is dropped.
  useEffect(() => {
    let stale = false;
    setWarning({ kind: "loading" });
    client
      .warning(project.id, level)
      .then((w) => {
        if (stale) return;
        setKnown(w);
        setWarning({ kind: "ready", warning: w });
      })
      .catch((e: unknown) => {
        if (!stale) setWarning({ kind: "error", message: messageOf(e) });
      });
    return () => {
      stale = true;
    };
  }, [client, project.id, level, warningTry]);

  const loadLinks = useCallback(async () => {
    try {
      const rows = await client.links(project.id);
      if (alive.current) setLinks({ kind: "ready", rows });
    } catch (e) {
      if (alive.current) setLinks({ kind: "error", message: messageOf(e) });
    }
  }, [client, project.id]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  async function create() {
    if (warning.kind !== "ready" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await client.mint({ projectId: project.id, level, days, label });
      if (!alive.current) return;
      setMinted(made);
      onSecretChange(true);
      announce("Your link is ready. It is shown only once.");
      void loadLinks();
    } catch (e) {
      if (alive.current) setError(messageOf(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function revoke(row: AwlLinkRow) {
    if (revoking) return;
    setRevoking(row.id);
    setError(null);
    try {
      await client.revoke(row.id);
      announce("Link revoked.");
      await loadLinks();
    } catch (e) {
      if (alive.current) setError(messageOf(e));
    } finally {
      if (alive.current) setRevoking(null);
    }
  }

  const level1Allowed = known?.maxLevel === 1;
  const activeLinkHere = links.kind === "ready" && links.rows.some((r) => r.status === "active");

  return (
    <div className="space-y-4">
      {minted ? (
        <ResultPanel minted={minted} projectName={project.name} warning={warning.kind === "ready" ? warning.warning : null} announce={announce} />
      ) : (
        <>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">What the AI may do</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name={levelName} checked={level === 0} onChange={() => setLevel(0)} className="mt-1" />
              <span>
                <span className="font-medium">{LEVEL_LABEL[0]}</span>: it reads the project and prepares drafts. Nothing changes until you confirm.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name={levelName} checked={level === 1} onChange={() => setLevel(1)} disabled={!level1Allowed} className="mt-1" />
              <span>
                <span className="font-medium">{LEVEL_LABEL[1]}</span>: it may record entries in your name, where your organisation has switched that on.
                {known && !level1Allowed && <span className="block text-muted-foreground">Your role can read and draft only.</span>}
                {known && level1Allowed && !known.writesEnabled && (
                  <span className="block text-muted-foreground" data-testid="awl-writes-off">
                    Direct entries are not switched on yet: this link reads and drafts only.
                  </span>
                )}
              </span>
            </label>
          </fieldset>
          <DaysPicker value={days} onChange={setDays} disabled={busy} />
          <div className="space-y-1.5">
            <label htmlFor={labelId} className="text-sm font-medium">Name for this link (optional)</label>
            <Input id={labelId} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="For example: my assistant at home" disabled={busy} />
          </div>

          <div className="rounded-md border border-border p-3" data-testid="awl-warning">
            <p className="mb-1 text-sm font-medium">Read this before you create the link</p>
            {warning.kind === "loading" && <p className="text-sm text-muted-foreground">Loading what this link would share...</p>}
            {warning.kind === "ready" && <p className="text-sm">{warning.warning.sentence}</p>}
            {warning.kind === "error" && (
              <div className="space-y-2">
                <p className="text-sm text-destructive" role="alert">{warning.message}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setWarningTry((n) => n + 1)}>Try again</Button>
              </div>
            )}
          </div>
          {activeLinkHere && (
            <p className="text-sm text-muted-foreground" data-testid="awl-replace-note">
              You already have a link for this project. Making a new one switches the earlier one off.
            </p>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" onClick={() => void create()} disabled={warning.kind !== "ready" || busy} data-testid="awl-create">
              {busy ? "Creating..." : "Create link"}
            </Button>
          </DialogFooter>
        </>
      )}
      {minted && error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <section aria-label="Your links for this project" className="space-y-2" data-testid="awl-links">
        <h3 className="text-sm font-medium">Your links for this project</h3>
        {links.kind === "loading" && <p className="text-sm text-muted-foreground">Loading your links...</p>}
        {links.kind === "error" && <p className="text-sm text-destructive" role="alert">{links.message}</p>}
        {links.kind === "ready" && links.rows.length === 0 && <p className="text-sm text-muted-foreground">You have no links for this project yet.</p>}
        {links.kind === "ready" && links.rows.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {links.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-testid="awl-link-row" data-status={row.status}>
                <div>
                  <p className="font-medium">{row.label ?? "Link without a name"}</p>
                  <p className="text-muted-foreground">
                    {LEVEL_LABEL[row.level]}, {row.status === "revoked" ? "revoked" : row.status === "expired" ? `expired ${formatWhen(row.expiresAt)}` : `expires ${formatWhen(row.expiresAt)}`}
                  </p>
                </div>
                {row.status === "active" && (
                  <Button type="button" variant="outline" size="sm" disabled={revoking !== null} onClick={() => void revoke(row)} aria-label={`Revoke link ${row.label ?? "without a name"}`}>
                    {revoking === row.id ? "Revoking..." : "Revoke"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {minted && (
        <DialogFooter>
          <Button type="button" onClick={onClose}>Done</Button>
        </DialogFooter>
      )}
    </div>
  );
}

// ---- mode "new-project" ----

function NewProjectBody({ client, onSecretChange, onClose, announce, onProjectCreated }: { client: AwlClient; onSecretChange: (shown: boolean) => void; onClose: () => void; announce: Announcer; onProjectCreated?: (project: AiLinkProject) => void }) {
  const [days, setDays] = useState<AwlDays>(7);
  const [minted, setMinted] = useState<AwlMinted | null>(null);
  const [warning, setWarning] = useState<AwlWarning | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await client.newProject({ days });
      if (!alive.current) return;
      setMinted(made);
      onSecretChange(true);
      announce("Your new project and its link are ready. The link is shown only once.");
      if (made.project) {
        onProjectCreated?.({ id: made.project.id, name: made.project.name ?? "New project" });
        // The warning for a project that did not exist a moment ago. Best effort: the link is already made and shown either way.
        client
          .warning(made.project.id, 0)
          .then((w) => {
            if (alive.current) setWarning(w);
          })
          .catch(() => {});
      }
    } catch (e) {
      if (alive.current) setError(messageOf(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {minted ? (
        <>
          <ResultPanel minted={minted} projectName={minted.project?.name ?? "the new project"} warning={warning} announce={announce} />
          <DialogFooter>
            <Button type="button" onClick={onClose}>Done</Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <p className="text-sm">
            This starts a new, empty project in your organisation and makes a read-and-draft link to it for your AI, so your AI can help you set it up.
            The project is yours to rename, fill in or delete like any other.
          </p>
          <DaysPicker value={days} onChange={setDays} disabled={busy} />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" onClick={() => void create()} disabled={busy} data-testid="awl-create-project">
              {busy ? "Creating..." : "Create project and link"}
            </Button>
          </DialogFooter>
        </>
      )}
    </div>
  );
}

// ---- the dialog ----

export function AiWorkLinkDialog({
  open,
  onOpenChange,
  mode,
  project,
  client,
  onProjectCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "project" | "new-project";
  /** The project of mode "project". Ignored for "new-project". */
  project: AiLinkProject | null;
  client: AwlClient;
  onProjectCreated?: (project: AiLinkProject) => void;
}) {
  const [announcement, setAnnouncement] = useState("");
  // Set while a link is on screen, read by the outside-click guard below. A ref, so setting it does not render.
  const secretShown = useRef(false);
  const onSecretChange = useCallback((shown: boolean) => {
    secretShown.current = shown;
  }, []);

  useEffect(() => {
    if (!open) {
      secretShown.current = false;
      setAnnouncement("");
    }
  }, [open]);

  const title = mode === "new-project" ? "New project with my AI" : `AI work link for ${project?.name ?? "a project"}`;
  const description =
    mode === "new-project"
      ? "Make a new project and give an AI assistant that only you use a link to it."
      : "Let an AI assistant that only you use read this project as you see it.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
        onInteractOutside={(event) => {
          if (secretShown.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* A polite live region that is there before anything changes, so a screen reader hears each result. */}
        <div role="status" aria-live="polite" className="sr-only" data-testid="awl-status">{announcement}</div>
        {open && mode === "project" && project && (
          <ProjectBody key={project.id} project={project} client={client} onSecretChange={onSecretChange} onClose={() => onOpenChange(false)} announce={setAnnouncement} />
        )}
        {open && mode === "new-project" && (
          <NewProjectBody client={client} onSecretChange={onSecretChange} onClose={() => onOpenChange(false)} announce={setAnnouncement} onProjectCreated={onProjectCreated} />
        )}
      </DialogContent>
    </Dialog>
  );
}
