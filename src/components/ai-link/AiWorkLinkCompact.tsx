"use client";

// PROJEXA -- WO ai-work-link-ui-and-projects-tab (2026-09-29). THE ONE-CLICK AI WORK LINK, and the ONE place that behaviour lives.
//
// AGREED DESIGN (several rounds of mockups, this session -- see AiWorkLinkButtons.tsx's own header for the two entry points this
// replaces): clicking used to always open AiWorkLinkDialog and make the person pick a level, a duration and read a server-fetched
// warning before Create was even enabled. The new default path is one click: mint immediately with the safe defaults -- level 0
// ("Read and draft", never "Direct entries") and 7 days -- copy the link straight to the clipboard, and show a small inline
// confirmation IN PLACE OF THE BUTTON, not a modal. Nothing about the warning-before-write safety gate is removed: the FULL picker
// (level/duration, the DB-sourced warning, Create) is one click away behind "Change access or expiry", which opens the exact same
// AiWorkLinkDialog this file used to open unconditionally -- the gate becomes optional rather than the default path, per the owner's
// own framing of this change.
//
// ONE COMPONENT, MULTIPLE CALL SITES. This is deliberately the ONLY place that mints with the one-click defaults and renders the
// confirmation sentence, reused byte-for-byte by:
//   - AiWorkLinkButtons.tsx      the top-rail "AI work link for this project" trigger (the prominent, `variant="default"` one)
//   - ProjectsListClient.tsx     each row's "Copy AI work link" action
//   - ProjectWorkspaceClient.tsx the workspace header's own trigger
// (M24Shell.tsx's left-panel "Work on this project with any AI" banner, a 4th call site, was removed 2026-09-30 -- it duplicated
// the top rail's trigger and read as clutter stacked above the 7-tab nav; see M24Shell.tsx's own comment where it used to be.)
// A caller that needs a different label passes `triggerLabel`; nothing else about the mint-copy-confirm behaviour varies by caller,
// which is the point -- call sites drifting into slightly different implementations is exactly what this file exists to prevent.
//
// ROLE GATING IS SELF-CONTAINED. Earlier, only AiWorkLinkButtons checked canMakeAiWorkLink(); the row action and the banner have no
// other component gating them, so this component checks it itself (same helper, same sentence, same "say nothing while role is still
// unknown" rule AiWorkLinkButtons.tsx has always followed) rather than trusting three different callers to remember to.
import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiWorkLinkDialog, type AiLinkProject } from "@/components/ai-link/AiWorkLinkDialog";
import { AI_ASSISTANT_NAMES, AI_WORK_LINK_ROLE_NOTE, canMakeAiWorkLink } from "@/lib/ai-work-link-access";
import { AwlError, getAwlClient, type AwlClient } from "@/lib/ai-work-link-client";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n/locales";

/** The safe defaults the one-click path mints with -- level 0 ("Read and draft", AiWorkLinkDialog.tsx's LEVEL_LABEL[0]) and 7 days.
 *  Exported so the confirmation sentence below and this file's own tests stay honest about what was actually minted rather than
 *  each restating "7 days" as a separate literal. */
export const AWL_ONE_CLICK_LEVEL = 0 as const;
export const AWL_ONE_CLICK_DAYS = 7 as const;

function mintErrorMessage(error: unknown): string {
  if (error instanceof AwlError) return error.message;
  return "Could not create the link. Try again.";
}

// 2026-09-30 (owner directive, local-testing feedback: "why two links, ideally only one" -- the composer used to place this
// component's own link-only trigger NEXT TO a second, separate "AI prompt" button that copied a generic instruction sentence with
// no real link in it, so pasting the prompt alone into an external AI left it with nothing to fetch. `copyMode="prompt"` merges the
// two into the ONE trigger this file's header already promises: one click mints the link AND copies a ready-to-paste message that
// carries the real link inline, so the external AI has everything in a single paste. Reuses this file's own mint/clipboard engine
// rather than a second implementation -- see the header's "ONE COMPONENT, MULTIPLE CALL SITES" rule.
const AI_PROMPT_LOCALE_LABEL: Record<SupportedLocale, string> = { en: "EN", hi: "हिं" };

/** The ready-to-paste message for the "prompt" copy mode, in each supported locale. Reuses AI_ASSISTANT_NAMES (brand names are not
 *  translated) and the real minted link -- never a placeholder asking the AI to request one, since this mode only ever runs after a
 *  real mint. Kept a plain function (not JSX) so the exact string is what the clipboard test below can assert on directly. */
function buildAiPrompt(link: string, moduleLabel: string | undefined, locale: SupportedLocale): string {
  const work = moduleLabel ? `"${moduleLabel}"` : "this";
  if (locale === "hi") {
    return [
      `मैं PROJEXA का उपयोग कर रहा/रही हूँ। यह मेरा निजी AI वर्क लिंक है: ${link}`,
      `कुछ भी करने से पहले इस लिंक पर एक सामान्य GET रिक्वेस्ट भेजें — यह एक पूरी मैनुअल देता है: मैं कौन हूँ, आप क्या पढ़ या बदल सकते हैं, आपको किन नियमों का पालन करना है, और बदलाव प्रस्तावित करने या करने का सही तरीका। इस संदेश की बजाय उसी मैनुअल का पालन करें — वह हमेशा इससे ज़्यादा अद्यतित होता है।`,
      `आज मुझे अपने ${work} काम में मदद चाहिए। इसे ${AI_ASSISTANT_NAMES} में से किसी में भी, या आपके किसी भी AI में पेस्ट किया जा सकता है।`,
    ].join(" ");
  }
  return [
    `I'm using PROJEXA. Here is my private AI work link: ${link}`,
    `Fetch that link first with a plain GET request, before doing anything else — it answers with a complete manual: who I am, what you're allowed to read or change, the rules you must follow, and exactly how to propose or make a change. Follow that manual, not this message — it is always more current than what I'm typing here.`,
    `Today I want help with my ${work} work. This can be pasted into ${AI_ASSISTANT_NAMES}, or any AI you use.`,
  ].join(" ");
}

export function AiWorkLinkCompact({
  role,
  project,
  client,
  triggerLabel = "AI work link",
  className,
  compact = false,
  variant = "outline",
  copyMode = "link",
  moduleLabel,
}: {
  /** The person's PROJEXA role, or null/undefined while it is not known yet -- see ai-work-link-access.ts. */
  role: string | null | undefined;
  /** The project this link is for, or null when none is selected (the trigger is disabled, matching the pre-existing button's own
   *  "Select a project first" behaviour). */
  project: AiLinkProject | null;
  /** The service client. The default is the signed-in browser's, same as every other AI work link surface. */
  client?: AwlClient;
  /** The trigger's visible label. Each of the 3 call sites names its own ("AI work link for this project", "Copy AI work link",
   *  ...) -- see this file's header for why the BEHAVIOUR behind the label never varies by caller. */
  triggerLabel?: string;
  className?: string;
  /** 2026-09-30 (local-testing feedback: the top rail's trigger was too easy to miss among the other header controls). Defaults to
   *  "outline" -- the Projects-list row action and the workspace header keep their existing, subtler look -- the top rail alone
   *  passes "default" for a filled, brand-coloured button that actually draws the eye, matching this app's own marketing-page CTAs. */
  variant?: "outline" | "default";
  /** WO ai-work-link-ui-and-projects-tab (2026-09-29), fixed same day (independent verify pass -- a real click-through, run for real
   *  via `bunx playwright test`, found this): the top rail's own header is a fixed h-9 (36px) with no overflow handling
   *  (TopRail.tsx), but the "done" state below used to always render 3 stacked lines (confirmation + a full sentence naming every
   *  assistant + the "Change access or expiry" button) -- tall enough to spill past 36px into the page content below it, which then
   *  visually covered "Change access or expiry" and made it unclickable (reproduced directly: a real Playwright click on it timed
   *  out, intercepted by a nav element from the main content area). AiWorkLinkButtons.tsx already had a `compact` prop for exactly
   *  this narrow-rail context (it just never reached this file) -- threaded through here now, collapsing the done/error states to
   *  ONE row instead of three so nothing can overflow a fixed-height rail regardless of viewport width. The left-panel banner and
   *  the Projects-list row action have real room and pass nothing, so they keep the fuller, unabbreviated text unchanged. */
  compact?: boolean;
  /** "link" (default, unchanged): copy the bare minted URL, same as before. "prompt" (M24Shell's composer, 2026-09-30): copy a
   *  ready-to-paste message with the real link embedded -- see buildAiPrompt above. */
  copyMode?: "link" | "prompt";
  /** Only read in "prompt" mode: the module the person is standing in (e.g. "Scope"), folded into the copied sentence as "today I
   *  want help with my X work". Omitted in "link" mode -- the bare link has no sentence to fold it into. */
  moduleLabel?: string;
}) {
  const [phase, setPhase] = useState<"idle" | "minting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // "Change access or expiry" opens the real dialog in ITS project mode -- the same warning-before-write mechanism this component's
  // own one-click path makes optional, never removed. Reachable both before minting (the error state's own escape hatch) and after.
  const [dialogOpen, setDialogOpen] = useState(false);
  // "prompt" mode only: the language the copied sentence is written in, and the real link once minted -- kept so switching the
  // language after the first copy just re-copies the same link in the new language, with no second mint (mint stays a one-time,
  // rate-limited action; only the clipboard text changes).
  const [locale, setLocale] = useState<SupportedLocale>(DEFAULT_LOCALE);
  const [mintedLink, setMintedLink] = useState<string | null>(null);
  const awl = client ?? getAwlClient();

  // Same "say nothing while unknown, say why once known" rule as AiWorkLinkButtons.tsx -- a button must never flash up and then
  // disappear once the real role answer arrives.
  if (!role) return null;
  if (!canMakeAiWorkLink(role)) {
    return (
      <p className={className} data-testid="awl-compact-role-note">
        {AI_WORK_LINK_ROLE_NOTE}
      </p>
    );
  }

  async function copyOneClick() {
    if (!project || phase === "minting") return;
    setPhase("minting");
    setError(null);
    try {
      const made = await awl.mint({ projectId: project.id, level: AWL_ONE_CLICK_LEVEL, days: AWL_ONE_CLICK_DAYS });
      try {
        await navigator.clipboard.writeText(copyMode === "prompt" ? buildAiPrompt(made.link, moduleLabel, locale) : made.link);
      } catch {
        // Clipboard denied/unavailable (e.g. an insecure context, or the permission refused): the link itself was still made and
        // is not lost -- "Change access or expiry" below opens the real dialog, whose own Input+Copy control (AiWorkLinkDialog.tsx's
        // ResultPanel) is the manual fallback this project has always had for exactly this case.
      }
      setMintedLink(made.link);
      setPhase("done");
    } catch (e) {
      setError(mintErrorMessage(e));
      setPhase("error");
    }
  }

  // "prompt" mode only, shown in both the idle and done states so the language can be picked before OR after the first copy.
  // Switching after a copy just re-copies the already-minted link in the new language -- no second mint. A no-op in "link" mode.
  function localeToggle() {
    if (copyMode !== "prompt") return null;
    return (
      <span className="inline-flex items-center gap-1" data-testid="awl-compact-locale-toggle">
        {SUPPORTED_LOCALES.map((code) => (
          <button
            key={code}
            type="button"
            data-testid={`awl-compact-locale-${code}`}
            aria-pressed={locale === code}
            title={code === "hi" ? "Copy the prompt in Hindi" : "Copy the prompt in English"}
            className="rounded px-1 text-[11px] font-medium"
            style={
              locale === code
                ? { background: "var(--color-veri-navy, #1C2B3A)", color: "#fff" }
                : { color: "var(--color-ct-muted)" }
            }
            onClick={() => {
              setLocale(code);
              if (mintedLink) void navigator.clipboard.writeText(buildAiPrompt(mintedLink, moduleLabel, code)).catch(() => {});
            }}
          >
            {AI_PROMPT_LOCALE_LABEL[code]}
          </button>
        ))}
      </span>
    );
  }

  if (phase === "done") {
    const fullSentence =
      copyMode === "prompt"
        ? `A ready-to-paste message was copied, with your link inside it — paste the whole thing into ${AI_ASSISTANT_NAMES}, or any AI you use. Read-and-draft access, expires in 7 days.`
        : `Paste it into ${AI_ASSISTANT_NAMES} — or any AI you use. Read-and-draft access, expires in 7 days.`;
    const copiedLabel = copyMode === "prompt" ? "Prompt copied" : "Link copied";
    return (
      <div className={className} data-testid="awl-compact-confirm">
        {compact ? (
          // ONE row, not three -- see this file's `compact` prop doc above for why. The full sentence is still reachable (the
          // row's own title tooltip, and in full inside the dialog "Change" opens) rather than silently dropped.
          <div className="flex items-center gap-1.5 text-sm" title={fullSentence}>
            <Check className="size-3.5 shrink-0" aria-hidden="true" style={{ color: "var(--color-veri-teal, #0E7C6E)" }} />
            <span className="font-medium" style={{ color: "var(--color-veri-teal, #0E7C6E)" }}>
              {copiedLabel}
            </span>
            {localeToggle()}
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-ct-navy underline"
              onClick={() => setDialogOpen(true)}
              data-testid="awl-compact-change"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <p className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--color-veri-teal, #0E7C6E)" }}>
              <Check className="size-3.5" aria-hidden="true" /> {copiedLabel}
            </p>
            <p className="text-xs text-muted-foreground">{fullSentence}</p>
            <div className="flex items-center gap-2">
              {localeToggle()}
              <button
                type="button"
                className="text-xs font-medium text-ct-navy underline"
                onClick={() => setDialogOpen(true)}
                data-testid="awl-compact-change"
              >
                Change access or expiry
              </button>
            </div>
          </>
        )}
        <AiWorkLinkDialog open={dialogOpen} onOpenChange={setDialogOpen} mode="project" project={project} client={awl} />
      </div>
    );
  }

  return (
    <div className={className}>
      <span className="inline-flex items-center gap-1.5">
        {localeToggle()}
        <Button
          type="button"
          variant={variant}
          size="sm"
          disabled={!project || phase === "minting"}
          title={project ? undefined : "Select a project first"}
          onClick={() => void copyOneClick()}
          data-testid="awl-compact-trigger"
        >
          <Link2 className="size-3.5" aria-hidden="true" />
          {phase === "minting" ? "Copying…" : triggerLabel}
        </Button>
      </span>
      {phase === "error" && (
        <p className={`mt-1 text-xs text-destructive ${compact ? "truncate" : ""}`} role="alert" data-testid="awl-compact-error" title={compact ? (error ?? undefined) : undefined}>
          {error}{" "}
          <button type="button" className="underline" onClick={() => setDialogOpen(true)} data-testid="awl-compact-change">
            {compact ? "Change" : "Change access or expiry"}
          </button>
        </p>
      )}
      <AiWorkLinkDialog open={dialogOpen} onOpenChange={setDialogOpen} mode="project" project={project} client={awl} />
    </div>
  );
}
