"use client";

// Real-screen conversion (2026-08-30): replaces RecruitmentClient.tsx's old
// "Add Candidate" Dialog popup with a real create screen. No Object Page --
// candidates are simple master data, no get/update function exists.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function CandidateCreateClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!name.trim() || !email.trim()) { toast.error("Name and email are required"); return; }
    setSubmitting(true);
    try {
      await fetchJson("/api/recruitment/candidates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone: phone || undefined, source: source || undefined }),
      });
      toast.success("Candidate added");
      router.push("/recruitment?tab=candidates");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add candidate"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Recruitment / New Candidate"
      title="Add Candidate"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/recruitment?tab=candidates")}
      onBack={() => router.push("/recruitment?tab=candidates")}
      saveDisabled={submitting || !name.trim() || !email.trim()}
      saveDisabledReason={submitting ? "Adding…" : !name.trim() || !email.trim() ? "Name and email are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Phone (optional)</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Source (optional)</Label><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. LinkedIn" /></div>
        </div>
      </div>
    </ObjectScreen>
  );
}
