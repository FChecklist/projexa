"use client";

// R67 lane D22 (items D-48/D-52): shows the receipt a completed flow left for
// the screen it navigated to.
//
// The kit's ObjectScreen renders these itself through its `messages` prop, so
// object pages need nothing extra. A plain module page (/schedule, /scope) is
// not an ObjectScreen, and this is the smallest honest equivalent: the same
// persistent, dismissible, level-coloured strip, never a toast -- the kit's own
// MessageArea header states the rule ("toasts vanish; errors must persist
// until resolved"), and a toast fired before router.push() races the navigation
// it is announcing.
import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { takeFooterMessage, type FooterMessage, type FooterMessageLevel } from "@/lib/footer-message";

const LEVEL_STYLE: Record<FooterMessageLevel, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: "border-px-success-border bg-px-success-light text-px-success" },
  info: { icon: Info, className: "border-px-info-border bg-px-info-light text-px-info" },
  warning: { icon: AlertTriangle, className: "border-px-warning-border bg-px-warning-light text-px-warning" },
  error: { icon: AlertCircle, className: "border-px-error-border bg-px-error-light text-px-error" },
};

export default function FooterMessageBanner({ route }: { route: string }) {
  const [message, setMessage] = useState<FooterMessage | null>(null);

  // Taken once on mount: the receipt is cleared from storage immediately, so a
  // reload does not re-announce something that happened twenty minutes ago,
  // while the message itself stays on screen until dismissed or navigated away
  // from.
  useEffect(() => { setMessage(takeFooterMessage(route)); }, [route]);

  if (!message) return null;
  const { icon: Icon, className } = LEVEL_STYLE[message.level];

  return (
    <div role="status" className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${className}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="flex-1">{message.text}</p>
      <button type="button" aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100" onClick={() => setMessage(null)}>
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
