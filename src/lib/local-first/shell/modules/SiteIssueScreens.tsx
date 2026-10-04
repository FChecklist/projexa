"use client";

// LOCAL-FIRST shell, RFIs, submittals and the punch list: list, object and "new" screens read from the laptop's own copy (site-records.ts)
// and changed through the outbox (site-writes.ts). Columns and facts are the online screens' where the laptop has the data. Who raised,
// answered or reviewed is not on the laptop (ids only) and is not shown. Approvals are the server's: the buttons only send the person's
// request, and the row says "Waiting to sync" until the server answers.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, ReadOnlyNote, SaveNote, Screen, StateMessage, Waiting, fieldClass, mayWrite, projectName, textHandlers, withProject } from "./DeliveryParts";
import { dateText } from "./DocumentsShared";
import { BACK_LINK, Chip, NeedsConnection, SectionText, useSiteSave, words } from "./SiteParts";
import {
  PUNCH_PRIORITIES, SUBMITTAL_DECISIONS, SUBMITTAL_TYPES, answerRfiOffline, canOffer, closeRfiOffline, createPunchItemOffline, createRfiOffline,
  createSubmittalOffline, markPunchReadyOffline, reviewSubmittalOffline, verifyPunchClosedOffline,
} from "./site-writes";
import type { ListData, LocalPunchItem, LocalRfi, LocalSubmittal, ObjectData } from "./site-records";

const label = (prefix: string, n: number | null) => (n === null ? `${prefix}-…` : `${prefix}-${n}`);

function Table4({ head, children, empty, isEmpty }: { head: string[]; children: React.ReactNode; empty: string; isEmpty: boolean }) {
  if (isEmpty) return <p className="mt-4 text-sm text-px-muted">{empty}</p>;
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
      <Table>
        <TableHeader>
          <TableRow>{head.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

function titleOf(base: string, shell: ShellScreenProps["shell"], projectId: string | null) {
  const name = projectName(shell, projectId ?? shell.projectId);
  return `${base}${name ? ` / ${name}` : ""}`;
}

// ─── RFIs ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function RfisListScreen({ shell, data }: ShellScreenProps<ListData<LocalRfi>>) {
  if (data.state !== "local") return <StateMessage testId="rfis-list" title="RFIs" state={data.state} what="RFI" />;
  const title = titleOf("RFIs", shell, data.projectId);
  return (
    <Screen testId="rfis-list" state="local" title={title}>
      <CopyNote testId="rfis-list-copy-note" syncedAt={data.syncedAt} />
      {mayWrite(shell) ? <p className="mt-3 text-sm"><a className={BACK_LINK} href={withProject("/rfis/new", data.projectId)}>New RFI</a></p> : null}
      <Table4 head={["#", "Subject", "Ball in Court", "Status"]} isEmpty={data.rows.length === 0} empty="No RFIs yet.">
        {data.rows.map((r) => (
          <TableRow key={r.id} data-testid="rfi-row" data-rfi-id={r.id}>
            <TableCell className="font-mono text-xs">{label("RFI", r.number)}</TableCell>
            <TableCell><a className="font-medium underline-offset-2 hover:underline" href={withProject(`/rfis/${encodeURIComponent(r.id)}`, data.projectId)}>{r.subject}</a><Waiting on={r.waiting} /></TableCell>
            <TableCell className="capitalize text-px-muted">{r.ballInCourt ?? DASH}</TableCell>
            <TableCell><Chip value={r.status} /></TableCell>
          </TableRow>
        ))}
      </Table4>
    </Screen>
  );
}

export function RfiObjectScreen({ shell, data }: ShellScreenProps<ObjectData<LocalRfi>>) {
  const [answer, setAnswer] = useState("");
  const { saving, note, save } = useSiteSave(shell);
  if (data.state !== "local") return <StateMessage testId="rfi-object" title="RFI" state={data.state} what="RFI" back={{ href: withProject("/rfis", shell.projectId), label: "Back to RFIs" }} />;
  const rfi = data.item;
  const projectId = data.projectId;
  const canAct = canOffer(shell.data.role, 2) && mayWrite(shell) && !rfi.waiting;
  return (
    <Screen testId="rfi-object" state="local" title={`${label("RFI", rfi.number)} — ${rfi.subject}`}>
      <CopyNote testId="rfi-object-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-2 text-sm"><Chip value={rfi.status} /><Waiting on={rfi.waiting} /></p>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-px-muted">Ball in Court</dt><dd className="capitalize">{rfi.ballInCourt ?? DASH}</dd>
        <dt className="text-px-muted">Due Date</dt><dd>{dateText(rfi.dueDate)}</dd>
      </dl>
      <SectionText title="Question" value={rfi.question} />
      <SectionText title="Answer" value={rfi.answer} />
      {!mayWrite(shell) ? <ReadOnlyNote /> : null}
      {canAct && rfi.status === "open" ? (
        <form className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="rfi-answer-form" onSubmit={async (e) => {
          e.preventDefault();
          if (await save(() => answerRfiOffline(shell.data, { projectId, rfiId: rfi.id, answer }))) setAnswer("");
        }}>
          <label className="block text-sm">Answer this RFI
            <textarea aria-label="Answer" className={fieldClass} rows={4} value={answer} {...textHandlers(setAnswer)} />
          </label>
          <Button type="submit" className="mt-3" disabled={saving}>{saving ? "Saving…" : "Submit answer"}</Button>
          <SaveNote note={note} />
        </form>
      ) : null}
      {canAct && rfi.status === "answered" ? (
        <div className="mt-4">
          <Button variant="outline" disabled={saving} data-testid="rfi-close" onClick={() => void save(() => closeRfiOffline(shell.data, { projectId, rfiId: rfi.id }))}>{saving ? "Saving…" : "Close this RFI"}</Button>
          <SaveNote note={note} />
        </div>
      ) : null}
      <p className="mt-4 text-sm"><a className={BACK_LINK} href={withProject("/rfis", projectId)}>Back to RFIs</a></p>
    </Screen>
  );
}

export function RfiNewScreen({ shell, data }: ShellScreenProps<ListData<LocalRfi>>) {
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const [dueDate, setDueDate] = useState("");
  const { saving, note, save } = useSiteSave(shell);
  if (data.state !== "local") return <StateMessage testId="rfi-new" title="New RFI" state={data.state} what="project" />;
  const projectId = data.projectId;
  return (
    <Screen testId="rfi-new" state="local" title={titleOf("New RFI", shell, projectId)}>
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="rfi-form" onSubmit={async (e) => {
          e.preventDefault();
          if (await save(() => createRfiOffline(shell.data, { projectId, subject, question, dueDate: dueDate || null }))) { setSubject(""); setQuestion(""); setDueDate(""); }
        }}>
          <label className="block text-sm">Subject<input aria-label="Subject" className={fieldClass} value={subject} {...textHandlers(setSubject)} required /></label>
          <label className="mt-3 block text-sm">Question<textarea aria-label="Question" className={fieldClass} rows={4} value={question} {...textHandlers(setQuestion)} required /></label>
          <label className="mt-3 block text-sm">Due Date (optional)<input aria-label="Due Date" type="date" className={fieldClass} value={dueDate} {...textHandlers(setDueDate)} /></label>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save RFI"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className={BACK_LINK} href={withProject("/rfis", projectId)}>Back to RFIs</a></p>
    </Screen>
  );
}

// ─── submittals ─────────────────────────────────────────────────────────────────────────────────────────────────

export function SubmittalsListScreen({ shell, data }: ShellScreenProps<ListData<LocalSubmittal>>) {
  if (data.state !== "local") return <StateMessage testId="submittals-list" title="Submittals" state={data.state} what="submittal" />;
  return (
    <Screen testId="submittals-list" state="local" title={titleOf("Submittals", shell, data.projectId)}>
      <CopyNote testId="submittals-list-copy-note" syncedAt={data.syncedAt} />
      {mayWrite(shell) ? <p className="mt-3 text-sm"><a className={BACK_LINK} href={withProject("/submittals/new", data.projectId)}>New submittal</a></p> : null}
      <Table4 head={["#", "Title", "Spec Section", "Status"]} isEmpty={data.rows.length === 0} empty="No submittals yet.">
        {data.rows.map((s) => (
          <TableRow key={s.id} data-testid="submittal-row" data-submittal-id={s.id}>
            <TableCell className="font-mono text-xs">{label("SUB", s.number)}</TableCell>
            <TableCell><a className="font-medium underline-offset-2 hover:underline" href={withProject(`/submittals/${encodeURIComponent(s.id)}`, data.projectId)}>{s.title}</a><Waiting on={s.waiting} /></TableCell>
            <TableCell className="text-px-muted">{s.specSection ?? DASH}</TableCell>
            <TableCell><Chip value={s.status} /></TableCell>
          </TableRow>
        ))}
      </Table4>
    </Screen>
  );
}

const DECISION_WORDS: Record<(typeof SUBMITTAL_DECISIONS)[number], string> = {
  approved: "Approve", approved_as_noted: "Approve as noted", revise_resubmit: "Revise & resubmit", rejected: "Reject",
};

export function SubmittalObjectScreen({ shell, data }: ShellScreenProps<ObjectData<LocalSubmittal>>) {
  const [comments, setComments] = useState("");
  const { saving, note, save } = useSiteSave(shell);
  if (data.state !== "local") return <StateMessage testId="submittal-object" title="Submittal" state={data.state} what="submittal" back={{ href: withProject("/submittals", shell.projectId), label: "Back to submittals" }} />;
  const s = data.item;
  const projectId = data.projectId;
  const canReview = canOffer(shell.data.role, 3) && mayWrite(shell) && !s.waiting && s.status === "pending";
  return (
    <Screen testId="submittal-object" state="local" title={`${label("SUB", s.number)} — ${s.title}`}>
      <CopyNote testId="submittal-object-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-2 text-sm"><Chip value={s.status} /><Waiting on={s.waiting} /></p>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-px-muted">Spec Section</dt><dd>{s.specSection ?? DASH}</dd>
        <dt className="text-px-muted">Type</dt><dd className="capitalize">{words(s.type)}</dd>
        <dt className="text-px-muted">Due Date</dt><dd>{dateText(s.dueDate)}</dd>
      </dl>
      <SectionText title="Review Comments" value={s.reviewComments} />
      {!mayWrite(shell) ? <ReadOnlyNote /> : null}
      {canReview ? (
        <div className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="submittal-review">
          <label className="block text-sm">Review this submittal
            <textarea aria-label="Review comments" className={fieldClass} rows={3} value={comments} {...textHandlers(setComments)} placeholder="Review comments (optional)" />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {SUBMITTAL_DECISIONS.map((d) => (
              <Button key={d} variant={d === "approved" ? "default" : "outline"} disabled={saving} data-testid={`review-${d}`}
                onClick={() => void save(() => reviewSubmittalOffline(shell.data, { projectId, submittalId: s.id, status: d, comments }))}>{DECISION_WORDS[d]}</Button>
            ))}
          </div>
          <SaveNote note={note} />
          <p className="mt-2 text-xs text-px-muted">The server makes the decision; this only sends your request.</p>
        </div>
      ) : null}
      <p className="mt-4 text-sm"><a className={BACK_LINK} href={withProject("/submittals", projectId)}>Back to submittals</a></p>
    </Screen>
  );
}

export function SubmittalNewScreen({ shell, data }: ShellScreenProps<ListData<LocalSubmittal>>) {
  const [title, setTitle] = useState("");
  const [specSection, setSpecSection] = useState("");
  const [type, setType] = useState<string>("shop_drawing");
  const [dueDate, setDueDate] = useState("");
  const { saving, note, save } = useSiteSave(shell);
  if (data.state !== "local") return <StateMessage testId="submittal-new" title="New submittal" state={data.state} what="project" />;
  const projectId = data.projectId;
  return (
    <Screen testId="submittal-new" state="local" title={titleOf("New submittal", shell, projectId)}>
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="submittal-form" onSubmit={async (e) => {
          e.preventDefault();
          if (await save(() => createSubmittalOffline(shell.data, { projectId, title, specSection, type, dueDate: dueDate || null }))) { setTitle(""); setSpecSection(""); setDueDate(""); }
        }}>
          <label className="block text-sm">Title<input aria-label="Title" className={fieldClass} value={title} {...textHandlers(setTitle)} required /></label>
          <label className="mt-3 block text-sm">Spec Section (optional)<input aria-label="Spec Section" className={fieldClass} value={specSection} {...textHandlers(setSpecSection)} /></label>
          <label className="mt-3 block text-sm">Type
            <select aria-label="Type" className={fieldClass} value={type} onChange={(e) => setType(e.target.value)}>
              {SUBMITTAL_TYPES.map((t) => <option key={t} value={t}>{words(t)}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm">Due Date (optional)<input aria-label="Due Date" type="date" className={fieldClass} value={dueDate} {...textHandlers(setDueDate)} /></label>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save submittal"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className={BACK_LINK} href={withProject("/submittals", projectId)}>Back to submittals</a></p>
    </Screen>
  );
}

// ─── punch list ─────────────────────────────────────────────────────────────────────────────────────────────────

export function PunchListScreen({ shell, data }: ShellScreenProps<ListData<LocalPunchItem>>) {
  if (data.state !== "local") return <StateMessage testId="punch-list" title="Punch List" state={data.state} what="item" />;
  return (
    <Screen testId="punch-list" state="local" title={titleOf("Punch List", shell, data.projectId)}>
      <CopyNote testId="punch-list-copy-note" syncedAt={data.syncedAt} />
      {mayWrite(shell) ? <p className="mt-3 text-sm"><a className={BACK_LINK} href={withProject("/punch-list/new", data.projectId)}>New item</a></p> : null}
      <Table4 head={["#", "Description", "Location", "Priority", "Status"]} isEmpty={data.rows.length === 0} empty="No punch list items yet.">
        {data.rows.map((i) => (
          <TableRow key={i.id} data-testid="punch-row" data-item-id={i.id}>
            <TableCell className="font-mono text-xs">{label("PL", i.number)}</TableCell>
            <TableCell><a className="font-medium underline-offset-2 hover:underline" href={withProject(`/punch-list/${encodeURIComponent(i.id)}`, data.projectId)}>{i.description}</a><Waiting on={i.waiting} /></TableCell>
            <TableCell className="text-px-muted">{i.location ?? DASH}</TableCell>
            <TableCell><Chip value={i.priority} /></TableCell>
            <TableCell><Chip value={i.status} /></TableCell>
          </TableRow>
        ))}
      </Table4>
    </Screen>
  );
}

export function PunchItemObjectScreen({ shell, data }: ShellScreenProps<ObjectData<LocalPunchItem>>) {
  const { saving, note, save } = useSiteSave(shell);
  if (data.state !== "local") return <StateMessage testId="punch-object" title="Punch list item" state={data.state} what="item" back={{ href: withProject("/punch-list", shell.projectId), label: "Back to the punch list" }} />;
  const item = data.item;
  const projectId = data.projectId;
  const base = mayWrite(shell) && !item.waiting;
  return (
    <Screen testId="punch-object" state="local" title={`${label("PL", item.number)} — ${item.description}`}>
      <CopyNote testId="punch-object-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-2 text-sm"><Chip value={item.status} /><Waiting on={item.waiting} /></p>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-px-muted">Location</dt><dd>{item.location ?? DASH}</dd>
        <dt className="text-px-muted">Trade</dt><dd>{item.trade ?? DASH}</dd>
        <dt className="text-px-muted">Priority</dt><dd className="capitalize">{item.priority ?? DASH}</dd>
        <dt className="text-px-muted">Due Date</dt><dd>{dateText(item.dueDate)}</dd>
      </dl>
      {!mayWrite(shell) ? <ReadOnlyNote /> : null}
      {base && item.status === "open" && canOffer(shell.data.role, 2) ? (
        <div className="mt-4"><Button disabled={saving} data-testid="punch-ready" onClick={() => void save(() => markPunchReadyOffline(shell.data, { projectId, itemId: item.id }))}>{saving ? "Saving…" : "Mark done"}</Button><SaveNote note={note} /></div>
      ) : null}
      {base && item.status === "ready_for_review" && canOffer(shell.data.role, 3) ? (
        <div className="mt-4">
          <Button disabled={saving} data-testid="punch-verify" onClick={() => void save(() => verifyPunchClosedOffline(shell.data, { projectId, itemId: item.id }))}>{saving ? "Saving…" : "Verify and close"}</Button>
          <SaveNote note={note} />
          <p className="mt-2 text-xs text-px-muted">The server makes the decision; this only sends your request.</p>
        </div>
      ) : null}
      <p className="mt-4 text-sm"><a className={BACK_LINK} href={withProject("/punch-list", projectId)}>Back to the punch list</a></p>
    </Screen>
  );
}

export function PunchItemNewScreen({ shell, data }: ShellScreenProps<ListData<LocalPunchItem>>) {
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [trade, setTrade] = useState("");
  const [priority, setPriority] = useState<string>("medium");
  const { saving, note, save } = useSiteSave(shell);
  if (data.state !== "local") return <StateMessage testId="punch-new" title="New punch list item" state={data.state} what="project" />;
  const projectId = data.projectId;
  return (
    <Screen testId="punch-new" state="local" title={titleOf("New punch list item", shell, projectId)}>
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="punch-form" onSubmit={async (e) => {
          e.preventDefault();
          if (await save(() => createPunchItemOffline(shell.data, { projectId, description, location, trade, priority }))) { setDescription(""); setLocation(""); setTrade(""); }
        }}>
          <label className="block text-sm">Description<input aria-label="Description" className={fieldClass} value={description} {...textHandlers(setDescription)} required /></label>
          <label className="mt-3 block text-sm">Location (optional)<input aria-label="Location" className={fieldClass} value={location} {...textHandlers(setLocation)} /></label>
          <label className="mt-3 block text-sm">Trade (optional)<input aria-label="Trade" className={fieldClass} value={trade} {...textHandlers(setTrade)} /></label>
          <label className="mt-3 block text-sm">Priority
            <select aria-label="Priority" className={fieldClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PUNCH_PRIORITIES.map((p) => <option key={p} value={p}>{words(p)}</option>)}
            </select>
          </label>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save item"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <NeedsConnection>Assigning the item to a person needs a connection.</NeedsConnection>
      <p className="mt-3 text-sm"><a className={BACK_LINK} href={withProject("/punch-list", projectId)}>Back to the punch list</a></p>
    </Screen>
  );
}

