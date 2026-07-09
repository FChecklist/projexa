"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";

type Rfi = {
  id: string; number: number; subject: string; question: string; status: string; ballInCourt: string;
  answer: string | null; dueDate: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive", answered: "secondary", closed: "outline",
};

export default function RfisClient({ projectId }: { projectId: string }) {
  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const [answering, setAnswering] = useState<Rfi | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/rfis?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setRfis(data.rfis ?? []);
    } catch {
      toast.error("Couldn't load RFIs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function createRfi() {
    if (!subject.trim() || !question.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/rfis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, subject, question }),
      });
      if (!res.ok) throw new Error();
      toast.success("RFI created");
      setSubject(""); setQuestion(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create RFI");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAnswer() {
    if (!answering || !answerText.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/rfis/${answering.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", answer: answerText }),
      });
      if (!res.ok) throw new Error();
      toast.success("RFI answered");
      setAnswering(null); setAnswerText("");
      load();
    } catch {
      toast.error("Couldn't answer RFI");
    } finally {
      setSubmitting(false);
    }
  }

  async function closeRfi(id: string) {
    try {
      const res = await fetch(`/api/rfis/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      if (!res.ok) throw new Error();
      toast.success("RFI closed");
      load();
    } catch {
      toast.error("Couldn't close RFI");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New RFI</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New RFI</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Question</Label><Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={4} /></div>
            </div>
            <DialogFooter><Button onClick={createRfi} disabled={submitting}>{submitting ? "Creating…" : "Create RFI"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : rfis.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No RFIs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Subject</TableHead><TableHead>Ball in Court</TableHead>
                  <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfis.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">RFI-{r.number}</TableCell>
                    <TableCell className="font-medium">{r.subject}</TableCell>
                    <TableCell className="capitalize text-px-muted">{r.ballInCourt}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge></TableCell>
                    <TableCell className="text-right space-x-2">
                      {r.status === "open" && (
                        <Button size="sm" variant="outline" onClick={() => { setAnswering(r); setAnswerText(""); }}>Answer</Button>
                      )}
                      {r.status === "answered" && (
                        <Button size="sm" variant="outline" onClick={() => closeRfi(r.id)}>Close</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!answering} onOpenChange={(v) => !v && setAnswering(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Answer: {answering?.subject}</DialogTitle></DialogHeader>
          <p className="text-sm text-px-muted">{answering?.question}</p>
          <Textarea value={answerText} onChange={(e) => setAnswerText(e.target.value)} rows={4} placeholder="Your answer…" />
          <DialogFooter><Button onClick={submitAnswer} disabled={submitting}>{submitting ? "Submitting…" : "Submit Answer"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
