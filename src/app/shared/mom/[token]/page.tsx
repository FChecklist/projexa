import { VERIDIAN_ORIGIN } from "@/lib/veridian-client";

// R67 D-21. The PUBLIC, read-only page a MoM share token resolves to.
//
// Deliberately outside src/app/(app)/ -- no sidebar, no nav, no app chrome, no
// session, no link back into the product (AR-10: render, never authorise),
// exactly like /share/report/[token] next door. It fetches VERIDIAN's public
// /api/veri-meetings/share/[token] with a plain unauthenticated fetch, never
// callVeridian/callVeridianRaw, which always resolve an API key first: the
// whole point of this page is that it needs no credentials of any kind.
//
// WHY IT EXISTS: the share link the WhatsApp button creates used to point at
// VERIDIAN's own /shared/meeting/<token> on VERIDIAN's own host. A PROJEXA
// customer's client would open a page belonging to a product they have never
// heard of. The PDF button relays through PROJEXA's own public route so this
// repo still gains no PDF library.
//
// An expired, revoked or deleted token 404s upstream, indistinguishably from
// one that never existed; this page renders the sentence the item specifies
// rather than Next's notFound(), because "expired" is a thing the reader can
// act on and a bare 404 is not.
type SharedActionItem = { id: string; task: { id: string; title: string; status: string; dueDate: string | null } | null };
type SharedMeeting = {
  id: string; title: string; meetingType: string; status: string; scheduledAt: string;
  systemId: string | null; projectName: string | null;
  attendees: string[]; agenda: string[]; minutes: string | null;
  aiSummary: string | null; aiKeyDecisions: string[];
  actionItems: SharedActionItem[]; expiresAt: string;
};

async function fetchSharedMeeting(token: string): Promise<SharedMeeting | null> {
  try {
    const res = await fetch(`${VERIDIAN_ORIGIN}/api/veri-meetings/share/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as SharedMeeting;
  } catch {
    return null;
  }
}

// This page has no session and therefore no org locale/zone to resolve, so
// dates are formatted the one way the rest of the shared surfaces already
// are: fixed locale, UTC, no invented timezone. Same reasoning as
// src/lib/format-date.ts's own pinned en-US/UTC comment.
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "UTC", hour12: false,
  }).format(date) + " UTC";
}

const PAGE: React.CSSProperties = { maxWidth: 820, margin: "0 auto", padding: "2rem 1.5rem", fontFamily: "sans-serif", color: "#1F2937" };

export default async function SharedMoMPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const meeting = await fetchSharedMeeting(token);

  if (!meeting) {
    return (
      <main style={PAGE}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Minutes of Meeting</h1>
        <p style={{ fontSize: "0.95rem" }}>This link has expired - ask the sender for a new one</p>
      </main>
    );
  }

  const decisions = meeting.aiKeyDecisions ?? [];
  const actionItems = (meeting.actionItems ?? []).filter((a) => a.task);

  return (
    <main style={PAGE}>
      <p style={{ fontSize: "0.75rem", color: "#888", marginBottom: "0.25rem" }}>
        Shared, read-only — expires {formatWhen(meeting.expiresAt)}
      </p>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>{meeting.title}</h1>
      <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
        {[meeting.projectName, formatWhen(meeting.scheduledAt), meeting.systemId].filter(Boolean).join(" · ")}
      </p>

      <p style={{ marginBottom: "1.75rem" }}>
        <a
          href={`/api/shared/mom/${encodeURIComponent(token)}/pdf`}
          style={{ display: "inline-block", border: "1px solid #1F2937", borderRadius: 6, padding: "0.4rem 0.9rem", fontSize: "0.875rem", textDecoration: "none", color: "#1F2937" }}
        >
          Download PDF
        </a>
      </p>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "0.95rem", marginBottom: "0.4rem" }}>Attendees</h2>
        {meeting.attendees?.length ? (
          <p style={{ fontSize: "0.875rem" }}>{meeting.attendees.join(", ")}</p>
        ) : (
          <p style={{ fontSize: "0.875rem", color: "#666" }}>None listed.</p>
        )}
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "0.95rem", marginBottom: "0.4rem" }}>Minutes</h2>
        {meeting.minutes?.trim() ? (
          <p style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{meeting.minutes}</p>
        ) : (
          <p style={{ fontSize: "0.875rem", color: "#666" }}>No minutes were recorded for this meeting.</p>
        )}
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "0.95rem", marginBottom: "0.4rem" }}>Decisions</h2>
        {decisions.length ? (
          <ul style={{ fontSize: "0.9rem", paddingLeft: "1.1rem", lineHeight: 1.55 }}>
            {decisions.map((d) => <li key={d}>{d}</li>)}
          </ul>
        ) : (
          <p style={{ fontSize: "0.875rem", color: "#666" }}>No decisions were recorded.</p>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "0.95rem", marginBottom: "0.4rem" }}>Action items</h2>
        {actionItems.length ? (
          <ul style={{ fontSize: "0.9rem", paddingLeft: "1.1rem", lineHeight: 1.55 }}>
            {actionItems.map((a) => (
              <li key={a.id}>
                {a.task!.title}
                {a.task!.dueDate ? ` — due ${formatWhen(a.task!.dueDate)}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: "0.875rem", color: "#666" }}>No action items were raised.</p>
        )}
      </section>
    </main>
  );
}
