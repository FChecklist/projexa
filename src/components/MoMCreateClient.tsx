"use client";

// Real-screen conversion (2026-08-30): replaces MoMsClient.tsx's old "New
// Meeting" Dialog popup with a real create screen.
//
// R67 D-20: `projectName` is required, not decorative -- the screen states
// which project it is about to write into, so a user can never save minutes
// into a project they did not knowingly pick. The route above this refuses to
// render the form at all without one.
//
// R67 D-67: onto the one create archetype. What changes: the breadcrumb now
// names the project (it read "Minutes of Meeting / New Meeting" with no
// project in it, on the one screen D-20 exists because of), the required
// fields are named in the primary's own label rather than only in a hover
// reason, and a save that lands leaves a receipt on the meeting page instead
// of a toast that fades. The POST contract is unchanged.
//
// ─── R67 D-18 (R-049), folded in by the integration train ───────────────────
// Two lanes rewrote this form. D-67's CreateScreen archetype is CANONICAL
// (decision D-11's rule of thumb: the version already on main wins the shape,
// the arriving lane folds its capability in), so D-18's hand-built
// ObjectScreen form is gone -- but every fault D-18 recorded is still fixed
// here, on the archetype:
//
//  - requiredMarks = 0. Both mandatory fields declare `required`, which is
//    what puts their names in the primary's own label ("Save (Title, Date &
//    time)") instead of leaving a button that silently will not press.
//  - Date & time started EMPTY, on a form whose meeting is usually happening
//    right now. It is seeded with the next quarter hour in the browser's zone,
//    and the zone is named under the field, because a bare
//    <input type="datetime-local"> value carries none. The wall clock is
//    converted to a real instant by toOrgInstant() on the way out -- D-74's
//    "10:30 bug" fix, which supersedes D-18's own zonedInputToIso() call for
//    the same reason D-11 gives: one mechanism per job.
//  - Type / Attendees / Agenda existed ONLY in Edit mode on the object page,
//    so the natural moment to capture them (while scheduling) was unreachable
//    and every new meeting started with an empty attendee list. All three are
//    fields here now and travel in the POST body, which /api/moms already
//    relays to createVeriMeeting.
//    HONEST REDUCTION: D-18 collected attendees as removable chips. CreateField
//    has no chip kind, and inventing one for a single screen is exactly the
//    per-screen divergence D-67 exists to end -- so attendees are a
//    comma-separated field, parsed by the SAME mom-form helper the chip UI
//    used (addAttendee, via buildCreateMeetingBody), and its tests still hold.
//  - Nothing told the user what happens after Save. The banner says so, and
//    the user still lands on the meeting with the minutes box focused (D-17).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { useSubmit } from "@/lib/use-submit";
import { toOrgInstant } from "@/lib/format";
import type { CreateField } from "@/lib/create-screen";
import { browserTimeZone, nextQuarterHourLocalInput, timeZoneHint } from "@/lib/org-time";
import { buildCreateMeetingBody } from "@/lib/mom-form";

const MEETING_TYPES = [
  { value: "team", label: "Team" },
  { value: "client", label: "Client" },
  { value: "vendor", label: "Vendor" },
  { value: "one_on_one", label: "One-on-one" },
  { value: "other", label: "Other" },
];

function buildFields(zoneHint: string): CreateField[] {
  return [
    { name: "title", label: "Title", kind: "text", required: true, placeholder: "e.g. Weekly site review", wide: true },
    {
      name: "scheduledAt",
      label: "Date & time",
      kind: "datetime-local",
      required: true,
      // The zone the pre-filled wall clock was computed in, stated rather than
      // assumed -- the control itself shows no zone at all.
      help: zoneHint ? `Times are in ${zoneHint}` : undefined,
    },
    { name: "meetingType", label: "Type", kind: "select", options: MEETING_TYPES },
    {
      name: "attendees",
      label: "Attendees",
      kind: "text",
      wide: true,
      placeholder: "e.g. Arjun Mehta, Priya Nair",
      help: "Separate names with a comma.",
    },
    { name: "agenda", label: "Agenda", kind: "textarea", wide: true, help: "One item per line." },
    // R67 lane D22 (item D-58, rec R-187), folded in at the integration merge.
    // A coordination meeting is minuted WHILE IT RUNS. Before this the screen
    // named "New Meeting" could not minute a meeting: minutes existed only on
    // the object page, so a site engineer had to save an empty shell first and
    // then go hunting for the field. compliance-tracker's createVeriMeeting DTO
    // already carries `minutes` (this lane widened it), so this is one field,
    // not a second write path.
    //
    // HONEST REDUCTION, in the same terms D-18's is stated above: lane D22 also
    // captured ACTION ITEMS here, as repeating rows with an owner picker and a
    // due date, and autosaved the whole form to the device. CreateField has no
    // repeating-row kind and no local-draft mechanism, and inventing either for
    // one screen is exactly the per-screen divergence D-67 exists to end. The
    // action items stay on the object page, one click after the receipt below
    // lands the user there.
    { name: "minutes", label: "Minutes", kind: "textarea", wide: true, help: "What was said. You can keep typing after the meeting is created." },
  ];
}

export default function MoMCreateClient({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  // The zone is read once, synchronously, so the required date field is never
  // empty on first paint -- an empty required field would read as
  // "Save (Title, Date & time)" for as long as any lookup took.
  const [zone] = useState(() => browserTimeZone());
  const [values, setValues] = useState<Record<string, string>>(() => ({
    meetingType: "team",
    scheduledAt: nextQuarterHourLocalInput(browserTimeZone()),
  }));

  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Meeting",
    buildRequest: () => {
      // R67 D-74 -- THE 10:30 BUG. `values.scheduledAt` is a datetime-local
      // value ("2026-09-02T10:30") and carries NO zone. Posted as it was, a
      // server running in UTC read it as 10:30 UTC and every render in the
      // org's own zone then showed 14:30 for a meeting scheduled at half
      // past ten. toOrgInstant attaches the org's offset at that moment,
      // which is the last point at which the user's intent is still known.
      const scheduledAt = toOrgInstant(values.scheduledAt);
      if (!scheduledAt) return null;
      // R67 D-18: the body is composed by the shared, unit-tested helper --
      // `toIso` is already resolved above, so this call cannot re-shift the
      // instant. A name still sitting unterminated in the attendees field is
      // included rather than silently dropped (addAttendee's own rule).
      const body = buildCreateMeetingBody(
        {
          title: values.title ?? "",
          scheduledAt: values.scheduledAt ?? "",
          meetingType: values.meetingType || "team",
          attendees: [],
          attendeeDraft: values.attendees ?? "",
          agenda: values.agenda ?? "",
        },
        projectId,
        () => scheduledAt
      );
      return {
        input: "/api/moms",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // R67 D-58: minutes travel with the create, when there are any. An
          // absent field is omitted rather than sent as "", so the DTO's own
          // "no minutes" state stays distinguishable from "minutes were
          // deliberately blanked".
          body: JSON.stringify(
            values.minutes?.trim() ? { ...body, minutes: values.minutes } : body
          ),
        },
      };
    },
    onSuccess: (meeting) => {
      const id = typeof meeting?.id === "string" ? meeting.id : "";
      if (!id) throw new Error("The server did not confirm a saved meeting");
      router.replace(createdHref("/moms", id, (values.title ?? "").trim()));
    },
  });

  return (
    <CreateScreen
      module="Minutes of Meeting"
      moduleHref={`/moms?projectId=${encodeURIComponent(projectId)}`}
      objectLabel="Meeting"
      fields={buildFields(timeZoneHint(zone))}
      values={values}
      onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={submit.submit}
      onCancel={() => router.push(`/moms?projectId=${encodeURIComponent(projectId)}`)}
      banner={
        // The one fact this screen exists to keep in front of the user: which
        // project the minutes are about to be written into -- and, since D-18,
        // what happens after Save, stated before the click rather than
        // discovered after it.
        <>
          <p className="text-[12px] text-px-muted">
            Project: <span style={{ color: "var(--color-veri-status-context)" }}>{projectName}</span>
          </p>
          <p className="text-[12px] text-px-muted">After saving you will type the minutes on the meeting page.</p>
        </>
      }
    />
  );
}
