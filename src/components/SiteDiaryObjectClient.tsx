"use client";

// Real-screen conversion (2026-08-30): site diary entries never had a
// detail view -- getSiteDiary() didn't exist before this conversion (only
// the list). Real Object Page on the kit's ObjectScreen. No Edit/Delete --
// no update/delete function exists; a diary entry is a write-once daily
// log (one row per project per day, a real unique constraint), same class
// as Attendance/Expenses/Stock Entries. Surfaces `visitors`,
// `materialReceived`, and `remarks` -- all real, always-accepted fields
// that were never shown anywhere (not even `instructions`, which the old
// Dialog DID collect but the list table never displayed).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type Diary = {
  id: string; projectId: string; diaryDate: string; weather: string | null; workDone: string | null;
  visitors: string | null; issues: string | null; instructions: string | null; materialReceived: string | null;
  labourCount: number | null; remarks: string | null;
};

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-ct-navy">{label}</h4>
      <p className="whitespace-pre-wrap text-sm text-ct-muted">{value}</p>
    </div>
  );
}

export default function SiteDiaryObjectClient({ diaryId }: { diaryId: string }) {
  const router = useRouter();
  const [diary, setDiary] = useState<Diary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    try {
      setDiary(await fetchJson<Diary>(`/api/site-diary/${diaryId}`));
      setLoadError(null);
    } catch (err) {
      setDiary(null);
      setLoadError(errorMessage(err, "Couldn't load this diary entry"));
    }
  }
  useEffect(() => { load(); }, [diaryId]);

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!diary) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Site Diary / Entry"
      title={formatDate(diary.diaryDate)}
      mode="display"
      hasDraft={false}
      facets={[
        { label: "Weather", value: diary.weather ?? "—" },
        { label: "Labour Count", value: diary.labourCount != null ? String(diary.labourCount) : "—" },
      ]}
      onBack={() => router.push(`/site-diary?projectId=${diary.projectId}`)}
      messages={[]}
    >
      <div className="space-y-4 px-4 py-3">
        <Field label="Work Done" value={diary.workDone} />
        <Field label="Visitors" value={diary.visitors} />
        <Field label="Material Received" value={diary.materialReceived} />
        <Field label="Issues" value={diary.issues} />
        <Field label="Instructions" value={diary.instructions} />
        <Field label="Remarks" value={diary.remarks} />
      </div>
    </ObjectScreen>
  );
}
