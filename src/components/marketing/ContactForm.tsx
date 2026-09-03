"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// Real "Talk to an Engineer" contact-capture form, wired to
// POST /api/contact -> src/lib/services/contact-service.ts -> the
// contact_requests table (drizzle/0010). Not a mailto: link, not a dead
// button -- a submitted row is real and queryable, which is the honest
// scope this repo can offer (no email/Resend infra exists here to send a
// confirmation, so this deliberately doesn't claim to send one).
export function ContactForm({ sourcePage }: { sourcePage: "home" | "how-it-works" }) {
  const t = useTranslations("Marketing.contactForm");
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error(t("errorRequired"));
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, message, sourcePage }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t("errorGeneric"));
      }
      setStatus("success");
      toast.success(t("successToast"));
    } catch (err) {
      setStatus("idle");
      toast.error(err instanceof Error ? err.message : t("errorGeneric"));
    }
  }

  if (status === "success") {
    return (
      <div id="contact-form" className="rounded-2xl border border-white/15 bg-white/5 p-6 text-center sm:p-8">
        <p className="font-heading text-lg font-semibold text-white">{t("successTitle")}</p>
        <p className="mt-2 text-sm leading-relaxed text-px-cloud2">{t("successBody")}</p>
      </div>
    );
  }

  return (
    <form
      id="contact-form"
      onSubmit={handleSubmit}
      className="rounded-2xl border border-white/15 bg-white/5 p-6 text-left sm:p-8"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${sourcePage}-name`} className="text-px-cloud2">{t("nameLabel")}</Label>
          <Input
            id={`${sourcePage}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="border-white/20 bg-white/10 text-white placeholder:text-px-cloud2/50"
            placeholder={t("namePlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${sourcePage}-email`} className="text-px-cloud2">{t("emailLabel")}</Label>
          <Input
            id={`${sourcePage}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border-white/20 bg-white/10 text-white placeholder:text-px-cloud2/50"
            placeholder={t("emailPlaceholder")}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${sourcePage}-company`} className="text-px-cloud2">{t("companyLabel")}</Label>
          <Input
            id={`${sourcePage}-company`}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="border-white/20 bg-white/10 text-white placeholder:text-px-cloud2/50"
            placeholder={t("companyPlaceholder")}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${sourcePage}-message`} className="text-px-cloud2">{t("messageLabel")}</Label>
          <Textarea
            id={`${sourcePage}-message`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="border-white/20 bg-white/10 text-white placeholder:text-px-cloud2/50"
            placeholder={t("messagePlaceholder")}
          />
        </div>
      </div>
      <Button
        type="submit"
        disabled={status === "loading"}
        size="lg"
        // R67 WS-G / C-13: navy on the unchanged saffron fill (5.55:1).
        className="mt-5 h-12 w-full bg-px-orange px-8 text-base text-ct-navy shadow-orange hover:bg-px-orange-hover sm:w-auto"
      >
        {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {t("submit")}
      </Button>
    </form>
  );
}
