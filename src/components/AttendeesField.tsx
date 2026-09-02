"use client";

// R67 lane D22 (item D-58, rec R-187): who was in the room.
//
// `veri_meetings.attendees` is a string[] of NAMES, not user ids, and that is
// deliberate -- schema.ts says so plainly: "external attendees may not be
// users". So this control has two jobs: pick colleagues out of the org so
// nobody retypes a name three different ways across three meetings, and let a
// consultant or a client's PM be added by name and company in the same field
// rather than in some second "other attendees" box.
//
// Names are stored, so removing a colleague from the org later never rewrites
// history: the MoM still says who attended.
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SearchSelect, { type SearchSelectOption } from "@/components/SearchSelect";

type OrgMember = { user_id: string; role: string; profiles: { email: string | null; display_name: string | null } | { email: string | null; display_name: string | null }[] | null };

/** Pure: the display name a membership row contributes to the attendee list. */
export function memberDisplayName(member: OrgMember): string | null {
  const profile = Array.isArray(member.profiles) ? member.profiles[0] ?? null : member.profiles;
  const name = profile?.display_name?.trim();
  if (name) return name;
  const email = profile?.email?.trim();
  return email || null;
}

/** Pure: how an external attendee reads in the list -- "Ravi Menon (Aecom)", or just the name when no company is given. */
export function externalAttendeeLabel(name: string, company: string): string {
  const n = name.trim();
  const c = company.trim();
  if (!n) return "";
  return c ? `${n} (${c})` : n;
}

export default function AttendeesField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [members, setMembers] = useState<SearchSelectOption[]>([]);
  const [addingExternal, setAddingExternal] = useState(false);
  const [externalName, setExternalName] = useState("");
  const [externalCompany, setExternalCompany] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/org-members")
      .then((r) => r.json())
      .then((data: { members?: OrgMember[] }) => {
        if (cancelled) return;
        const options: SearchSelectOption[] = [];
        for (const member of data.members ?? []) {
          const name = memberDisplayName(member);
          // A membership row with no name and no email would render as a blank
          // chip nobody could identify -- it contributes nothing.
          if (name) options.push({ value: name, label: name, sublabel: member.role });
        }
        setMembers(options);
      })
      // A directory that will not load must not block minuting a meeting --
      // "Add external" still takes any name typed by hand.
      .catch(() => { if (!cancelled) setMembers([]); });
    return () => { cancelled = true; };
  }, []);

  function add(name: string) {
    const trimmed = name.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
  }

  return (
    <div className="space-y-2">
      <Label>Attendees</Label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((name) => (
            <li key={name} className="inline-flex items-center gap-1 rounded-full border border-px-border2 px-2 py-0.5 text-[12.5px]">
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                className="text-px-muted hover:text-px-ink"
                onClick={() => onChange(value.filter((a) => a !== name))}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchSelect
          ariaLabel="Add an attendee from your organisation"
          className="min-w-[240px] flex-1"
          value={null}
          onChange={(next) => { if (next) add(next); }}
          options={members.filter((m) => !value.includes(m.value))}
          placeholder={members.length === 0 ? "Type a name, or use Add external" : "Type a name…"}
          emptyText="Nobody left to add from your organisation"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setAddingExternal((v) => !v)}>
          <Plus className="size-3.5" aria-hidden="true" /> Add external
        </Button>
      </div>

      {addingExternal && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-px-border2 p-3">
          <div className="space-y-1"><Label className="text-[12px]">Name</Label><Input className="w-48" value={externalName} onChange={(e) => setExternalName(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-[12px]">Company</Label><Input className="w-48" value={externalCompany} onChange={(e) => setExternalCompany(e.target.value)} /></div>
          <Button
            type="button"
            size="sm"
            disabled={!externalName.trim()}
            title={externalName.trim() ? undefined : "Name"}
            onClick={() => {
              add(externalAttendeeLabel(externalName, externalCompany));
              setExternalName("");
              setExternalCompany("");
              setAddingExternal(false);
            }}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
