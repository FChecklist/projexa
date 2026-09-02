"use client";

// Real-screen conversion (2026-08-30): replaces MoMsClient.tsx's old "New
// Meeting" Dialog popup with a real create screen.
//
// R67 D-18 (R-049). What the audit recorded about this form and what changed:
//  - requiredMarks = 0. Neither mandatory field said it was mandatory, so the
//    only signal was a Save button that would not press. Both labels now read
//    "(required)" and both controls carry aria-required.
//  - Date & time started EMPTY, on a form whose meeting is usually happening
//    right now. It is pre-filled with the next quarter hour, and -- because a
//    bare <input type="datetime-local"> value carries no zone at all -- the
//    zone it was computed in is named under the field and used to build the
//    real instant that gets posted. See src/lib/org-time.ts for why the old
//    "post the raw wall-clock string" behaviour resolved against the browser
//    on the way in and a UTC serverless function on the way out.
//  - Type / Attendees / Agenda existed ONLY in Edit mode on the object page,
//    so the natural moment to capture them (while scheduling) was unreachable
//    and every new meeting started with an empty attendee list. All three are
//    here now and travel in the POST body, which /api/moms already relays to
//    createVeriMeeting.
//  - Nothing told the user what happens after Save. It now says so, and the
//    user lands on the meeting with the minutes box focused (D-17).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { browserTimeZone, nextQuarterHourLocalInput, resolveOrgTimeZone, timeZoneHint, zonedInputToIso } from "@/lib/org-time";
import { TITLE_REQUIRED_MESSAGE, addAttendee, buildCreateMeetingBody, missingMeetingFields } from "@/lib/mom-form";

const MEETING_TYPES: { value: string; label: string }[] = [
  { value: "team", label: "Team" },
  { value: "client", label: "Client" },
  { value: "vendor", label: "Vendor" },
  { value: "one_on_one", label: "One-on-one" },
  { value: "other", label: "Other" },
];

// PROJEXA's organizations table has no timezone column today (schema.ts:
// name/slug/country only), so this field is absent from the response and the
// browser's own zone is used. Typed as optional so the moment the column and
// the /api/organization projection exist, this form starts honouring it with
// no further change here.
type OrganizationResponse = { organization?: { timezone?: string | null } | null };

export default function MoMCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  // A ref, not state: the mount effect below reads it AFTER an await, so a
  // value captured at render time would be permanently stale.
  const dateTouchedRef = useRef(false);
  const [meetingType, setMeetingType] = useState("team");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [attendeeDraft, setAttendeeDraft] = useState("");
  const [agenda, setAgenda] = useState("");
  const [timeZone, setTimeZone] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Two-step on purpose. The browser's zone is known synchronously, so the
  // field is never empty on first paint (an empty required field would read
  // as "Save (Title, Date & time)" for as long as the network takes). If the
  // organisation later reports a DIFFERENT zone, the pre-fill is recomputed --
  // but only while the user has not touched the field, so a typed value is
  // never overwritten underneath them.
  useEffect(() => {
    const local = browserTimeZone();
    setTimeZone(local);
    setScheduledAt(nextQuarterHourLocalInput(local));

    let cancelled = false;
    fetchJson<OrganizationResponse>("/api/organization")
      .then((data) => {
        if (cancelled) return;
        const resolved = resolveOrgTimeZone(data.organization?.timezone, local);
        if (resolved === local) return;
        setTimeZone(resolved);
        setScheduledAt((current) => (dateTouchedRef.current ? current : nextQuarterHourLocalInput(resolved)));
      })
      .catch(() => {
        // A failed org read is not a reason to block creating a meeting --
        // the browser zone is already in use and is named on screen.
      });
    return () => { cancelled = true; };
    // Mount only. Whether the user has touched the field is read from a ref
    // (not from state captured in this closure) precisely so this can stay a
    // one-shot effect without ever clobbering a value typed while the
    // organisation call was still in flight.
  }, []);

  const missing = missingMeetingFields({ title, scheduledAt });
  const titleError = titleTouched && !title.trim() ? TITLE_REQUIRED_MESSAGE : null;

  function commitAttendee() {
    setAttendees((prev) => addAttendee(prev, attendeeDraft));
    setAttendeeDraft("");
  }

  async function createMeeting() {
    if (missing.length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const meeting = await fetchJson<{ id: string }>("/api/moms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // scheduledAt goes out as the real instant the typed wall clock means
        // in the named zone -- not the bare string, which the browser and a
        // UTC serverless function resolved differently.
        body: JSON.stringify(
          buildCreateMeetingBody(
            { title, scheduledAt, meetingType, attendees, attendeeDraft, agenda },
            projectId,
            (wallClock) => zonedInputToIso(wallClock, timeZone)
          )
        ),
      });
      // D-17: land on the meeting with the minutes box focused and a footer
      // message naming what was made. The message itself is composed on the
      // object page, which is where the system id is known.
      router.push(`/moms/${meeting.id}?focus=minutes&created=1`);
    } catch (err) {
      // GLOBAL: errors persist in the message band, they do not vanish as a toast.
      setSubmitError(errorMessage(err, "Couldn't create meeting"));
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Minutes of Meeting / New Meeting"
      title="New Meeting"
      mode="create"
      hasDraft={false}
      onSave={createMeeting}
      onCancel={() => router.push(`/moms?projectId=${projectId}`)}
      onBack={() => router.push(`/moms?projectId=${projectId}`)}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Creating…" : missing.length ? missing.join(", ") : undefined}
      messages={[
        ...(submitError ? [{ level: "error" as const, text: submitError }] : []),
        ...(titleError ? [{ field: "title", level: "warning" as const, text: titleError }] : []),
      ]}
    >
      <div className="space-y-3 px-4 py-3">
        <FormField label="Title (required)" error={titleError ? <ErrorText text={titleError} /> : null}>
          {(p) => (
            <Input
              {...p}
              aria-required
              value={title}
              placeholder="e.g. Weekly Site Coordination - Villa 21"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTitleTouched(true)}
            />
          )}
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Date & time (required)"
            hint={timeZone ? `Times are in ${timeZoneHint(timeZone)}` : undefined}
          >
            {(p) => (
              <Input
                {...p}
                aria-required
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => { dateTouchedRef.current = true; setScheduledAt(e.target.value); }}
              />
            )}
          </FormField>

          <FormField label="Type">
            {(p) => (
              <Select value={meetingType} onValueChange={setMeetingType}>
                <SelectTrigger id={p.id}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEETING_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </FormField>
        </div>

        <FormField label="Attendees" hint="Press Enter or comma after each name.">
          {(p) => (
            <div className="space-y-1.5">
              {attendees.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {attendees.map((name) => (
                    <Badge key={name} variant="outline" className="gap-1">
                      {name}
                      <button
                        type="button"
                        aria-label={`Remove ${name}`}
                        onClick={() => setAttendees((prev) => prev.filter((a) => a !== name))}
                        className="text-px-muted hover:text-px-ink"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Input
                {...p}
                value={attendeeDraft}
                placeholder="Add a name"
                onChange={(e) => setAttendeeDraft(e.target.value)}
                onBlur={commitAttendee}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitAttendee(); }
                }}
              />
            </div>
          )}
        </FormField>

        <FormField label="Agenda" hint="One item per line.">
          {(p) => <Textarea {...p} value={agenda} rows={3} onChange={(e) => setAgenda(e.target.value)} />}
        </FormField>

        {/* What happens next, stated before the click rather than discovered
            after it -- this form's whole purpose is to get the user to the
            minutes box while the meeting is still running. */}
        <p className="pt-1 text-xs text-px-muted">After saving you will type the minutes on the meeting page.</p>
      </div>
    </ObjectScreen>
  );
}

// Glyph + text, never colour alone (GLOBAL). `destructive` and `px-error`
// resolve to the same #C0392B in globals.css; the shared FormField already
// uses the former for its message slot.
function ErrorText({ text }: { text: string }) {
  return (
    <span className="inline-flex items-start gap-1">
      <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
      {text}
    </span>
  );
}
