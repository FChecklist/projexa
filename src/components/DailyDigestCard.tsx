"use client";

// Owner directive 2026-09-19: the org-configurable start-of-day/end-of-day
// digest schedule. Same placement/gating convention as BoqCategoriesCard --
// rendered for every member (everyone should see when their org's digest
// goes out), edit controls only for owner/admin (mirrors
// requireRole(ORG_ADMIN) on PUT /api/organization/email-schedule).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, X } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type ScheduleRow = { slot: "morning" | "evening" | "custom"; label: string; localTime: string; enabled: boolean };

// Curated to PROJEXA's real markets (India + the Gulf), same reasoning as
// SettingsClient's own CURRENCY_OPTIONS -- a free-text IANA field invites a
// typo an org would then be silently mis-scheduled by.
const TIMEZONE_OPTIONS: { tz: string; label: string }[] = [
  { tz: "Asia/Kolkata", label: "India (IST)" },
  { tz: "Asia/Dubai", label: "UAE (GST)" },
  { tz: "Asia/Riyadh", label: "Saudi Arabia (AST)" },
  { tz: "Asia/Qatar", label: "Qatar (AST)" },
  { tz: "Asia/Kuwait", label: "Kuwait (AST)" },
  { tz: "Asia/Bahrain", label: "Bahrain (AST)" },
  { tz: "Asia/Muscat", label: "Oman (GST)" },
  { tz: "UTC", label: "UTC" },
];

export default function DailyDigestCard({ canEdit }: { canEdit: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [morning, setMorning] = useState<ScheduleRow>({ slot: "morning", label: "Start of day", localTime: "09:00", enabled: true });
  const [evening, setEvening] = useState<ScheduleRow>({ slot: "evening", label: "End of day", localTime: "18:00", enabled: true });
  const [custom, setCustom] = useState<ScheduleRow | null>(null);

  useEffect(() => {
    fetchJson<{ timezone?: string; schedules?: ScheduleRow[] }>("/api/organization/email-schedule")
      .then((data) => {
        if (data.timezone) setTimezone(data.timezone);
        const found = data.schedules ?? [];
        const m = found.find((s) => s.slot === "morning");
        const e = found.find((s) => s.slot === "evening");
        const c = found.find((s) => s.slot === "custom");
        if (m) setMorning(m);
        if (e) setEvening(e);
        if (c) setCustom(c);
      })
      .catch((err) => toast.error(errorMessage(err, "Couldn't load the digest schedule")))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const schedules = [morning, evening, ...(custom ? [custom] : [])];
      const res = await fetch("/api/organization/email-schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone, schedules }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save the digest schedule");
      toast.success("Digest schedule saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save the digest schedule");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Daily Digest</CardTitle></CardHeader>
        <CardContent className="grid h-24 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-card">
      <CardHeader><CardTitle className="text-base">Daily Digest</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-px-muted">
          Every member gets an email at these times, with what&apos;s open and a number next to each item -- reply with the number and what happened (e.g. &quot;1 done&quot;) to update it, no sign-in needed.
        </p>

        <div className="flex items-center gap-3">
          <span className="text-xs text-px-muted w-20 shrink-0">Timezone</span>
          {canEdit ? (
            <Select value={timezone} onValueChange={setTimezone} disabled={saving}>
              <SelectTrigger size="sm" className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((t) => <SelectItem key={t.tz} value={t.tz}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <span className="font-medium text-px-ink">{TIMEZONE_OPTIONS.find((t) => t.tz === timezone)?.label ?? timezone}</span>
          )}
        </div>

        <ScheduleSlotRow row={morning} onChange={setMorning} canEdit={canEdit} />
        <ScheduleSlotRow row={evening} onChange={setEvening} canEdit={canEdit} />

        {custom ? (
          <div className="flex items-center gap-2">
            <div className="flex-1"><ScheduleSlotRow row={custom} onChange={setCustom} canEdit={canEdit} /></div>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setCustom(null)} disabled={saving}>
                <X className="size-4" />
              </Button>
            )}
          </div>
        ) : (
          canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCustom({ slot: "custom", label: "Third check-in", localTime: "13:00", enabled: true })}
            >
              <Plus className="size-4" /> Add a third email
            </Button>
          )
        )}

        {canEdit && (
          <div className="pt-2">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleSlotRow({ row, onChange, canEdit }: { row: ScheduleRow; onChange: (r: ScheduleRow) => void; canEdit: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {canEdit ? (
        <Switch checked={row.enabled} onCheckedChange={(enabled) => onChange({ ...row, enabled })} />
      ) : (
        <span className={`size-2 rounded-full ${row.enabled ? "bg-emerald-500" : "bg-px-muted/40"}`} />
      )}
      <span className="text-sm text-px-ink w-32 shrink-0">{row.label}</span>
      {canEdit ? (
        <Input
          type="time"
          value={row.localTime}
          onChange={(e) => onChange({ ...row, localTime: e.target.value })}
          className="w-28"
          disabled={!row.enabled}
        />
      ) : (
        <span className="font-medium text-px-ink">{row.enabled ? row.localTime : "off"}</span>
      )}
    </div>
  );
}
