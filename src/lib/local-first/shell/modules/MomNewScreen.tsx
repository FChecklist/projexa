"use client";

// LOCAL-FIRST shell, New meeting (/moms/new): title, date and time, type, attendees, agenda and minutes; kept on the laptop at once
// and created by the server through the registry's create_mom when connected (G-15: this screen used to need a connection).
// The meeting's number, and who may see it, are the server's. Action items (R-C04) are a title and an optional due date each; the server makes
// each one a task for the person who saves the meeting, and the person who owns it is chosen online (the people list is not kept here).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShellScreenProps } from "../types";
import { createMomOffline } from "./documents-writes";
import { CopyNote, ReadOnlyNote, Screen, StateMessage, fieldClass, mayWrite, projectName, textHandlers, withProject } from "./DeliveryParts";
import type { MomsListData } from "./moms-adapter";

const lines = (v: string): string[] => v.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
/** Now, as the value a datetime-local box takes (local time, minutes). */
const nowLocal = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function MomNewScreen({ shell, data }: ShellScreenProps<MomsListData>) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(nowLocal());
  const [type, setType] = useState("");
  const [attendees, setAttendees] = useState("");
  const [agenda, setAgenda] = useState("");
  const [minutes, setMinutes] = useState("");
  const [items, setItems] = useState<{ title: string; due: string }[]>([{ title: "", due: "" }]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // the value is read by textHandlers before this runs: an event's currentTarget is gone by the time a state updater is called
  const setItem = (index: number, patch: Partial<{ title: string; due: string }>) => setItems((all) => all.map((x, j) => (j === index ? { ...x, ...patch } : x)));

  if (data.state !== "local") return <StateMessage testId="mom-new" title="New meeting" state={data.state} what="meeting" />;
  const projectId = data.projectId;
  const label = projectName(shell, projectId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await createMomOffline(shell.data, { projectId, title, scheduledAt: when, meetingType: type, attendees: lines(attendees), agenda: lines(agenda), minutes, actionItems: items.map((i) => ({ title: i.title, dueDate: i.due })) });
      if (r.ok) {
        setNote({ ok: true, text: shell.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected." });
        setTitle("");
        setType("");
        setAttendees("");
        setAgenda("");
        setMinutes("");
        setItems([{ title: "", due: "" }]);
        shell.refresh();
      } else {
        setNote({ ok: false, text: r.message });
      }
    } catch {
      setNote({ ok: false, text: "This meeting could not be kept on this laptop. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen testId="mom-new" state="local" title={`New meeting${label ? ` / ${label}` : ""}`}>
      <CopyNote testId="mom-new-copy-note" syncedAt={data.syncedAt} />
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="mom-new-form">
          <label className="block text-sm">
            Title
            <input aria-label="Title" className={fieldClass} value={title} {...textHandlers(setTitle)} required />
          </label>
          <label className="mt-3 block text-sm">
            Date and time
            <input aria-label="Date and time" type="datetime-local" className={fieldClass} value={when} {...textHandlers(setWhen)} required />
          </label>
          <label className="mt-3 block text-sm">
            Type of meeting (optional)
            <input aria-label="Type of meeting" className={fieldClass} value={type} {...textHandlers(setType)} />
          </label>
          <label className="mt-3 block text-sm">
            Attendees (names, one per line or separated by commas)
            <textarea aria-label="Attendees" className={fieldClass} rows={3} value={attendees} onChange={(e) => setAttendees(e.currentTarget.value)} onInput={(e) => setAttendees(e.currentTarget.value)} />
          </label>
          <label className="mt-3 block text-sm">
            Agenda (one item per line)
            <textarea aria-label="Agenda" className={fieldClass} rows={3} value={agenda} onChange={(e) => setAgenda(e.currentTarget.value)} onInput={(e) => setAgenda(e.currentTarget.value)} />
          </label>
          <label className="mt-3 block text-sm">
            Minutes (optional)
            <textarea aria-label="Minutes" className={fieldClass} rows={5} value={minutes} onChange={(e) => setMinutes(e.currentTarget.value)} onInput={(e) => setMinutes(e.currentTarget.value)} />
          </label>
          <fieldset className="mt-3" data-testid="mom-new-actions">
            <legend className="text-sm">Action items (what was agreed, optional)</legend>
            {items.map((item, i) => (
              <div key={i} className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                <input aria-label={`Action item ${i + 1}`} className={fieldClass} value={item.title} {...textHandlers((v) => setItem(i, { title: v }))} />
                <input aria-label={`Due date for action item ${i + 1}`} type="date" className={fieldClass} value={item.due} {...textHandlers((v) => setItem(i, { due: v }))} />
              </div>
            ))}
            <button type="button" className="mt-2 text-sm text-px-ink underline underline-offset-2" onClick={() => setItems((all) => [...all, { title: "", due: "" }])}>Add another action item</button>
            <p className="mt-1 text-xs text-px-muted">Each one becomes a task for you when the meeting reaches the server; who owns it is set online. Publishing the minutes and the PDF are online only.</p>
          </fieldset>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save meeting"}</Button>
          {note ? (
            <p role="status" aria-live="polite" className="mt-3 text-sm text-px-ink" data-testid="save-note" data-ok={note.ok ? "1" : "0"}>{note.text}</p>
          ) : null}
        </form>
      )}
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/moms", projectId)}>Back to meetings</a></p>
    </Screen>
  );
}
