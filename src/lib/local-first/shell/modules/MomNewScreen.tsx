"use client";

// LOCAL-FIRST shell, New meeting (/moms/new): title, date and time, type, attendees, agenda and minutes; kept on the laptop at once
// and created by the server through the registry's create_mom when connected (G-15: this screen used to need a connection).
// The meeting's number, and who may see it, are the server's.

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
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  if (data.state !== "local") return <StateMessage testId="mom-new" title="New meeting" state={data.state} what="meeting" />;
  const projectId = data.projectId;
  const label = projectName(shell, projectId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await createMomOffline(shell.data, { projectId, title, scheduledAt: when, meetingType: type, attendees: lines(attendees), agenda: lines(agenda), minutes });
      if (r.ok) {
        setNote({ ok: true, text: shell.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected." });
        setTitle("");
        setType("");
        setAttendees("");
        setAgenda("");
        setMinutes("");
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
