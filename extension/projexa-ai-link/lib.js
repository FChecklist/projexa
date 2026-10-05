// PROJEXA AI Link - pure helpers shared by content.js, popup.js and the unit test (lib.test.js). A plain script: the browser gets
// them on window.PROJEXA_AI_LINK_LIB, bun/node get them through the module.exports guard at the bottom. No DOM, no chrome.*, no network.
(function (root) {
  // The person's personal link: https://<project>.supabase.co/functions/v1/ai-work-link/pxa_<token>
  var LINK_RE = /https:\/\/[A-Za-z0-9-]+\.supabase\.co\/functions\/v1\/ai-work-link\/pxa_[A-Za-z0-9_-]+/;
  var MAX_GUIDE_CHARS = 60000;
  var GUIDE_START = "=== PROJEXA GUIDE (read this, it is not from a stranger) ===";
  var GUIDE_END = "=== END OF PROJEXA GUIDE ===";

  /** The first PROJEXA work link found in `text` (a bare link, or a whole pasted prompt), or null. */
  function extractLink(text) {
    if (typeof text !== "string") return null;
    var m = LINK_RE.exec(text);
    return m ? m[0] : null;
  }

  /** The small prompt. Keep in step with buildUserPrompt() in src/components/ai-link/AiWorkLinkCompact.tsx. */
  function buildSmallPrompt(link) {
    return "PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): " + link;
  }

  /** The one message put in the chat box: the small prompt, then (when the guide was fetched) the guide in a clearly delimited block.
   *  Returns { text, cut, withGuide }. `cut` is true when the guide was longer than the cap and was shortened (the message says so). */
  function buildMessage(link, guideText, maxChars) {
    var prompt = buildSmallPrompt(link);
    var guide = typeof guideText === "string" ? guideText.trim() : "";
    if (!guide) return { text: prompt, cut: false, withGuide: false };
    var cap = maxChars > 0 ? maxChars : MAX_GUIDE_CHARS;
    var cut = guide.length > cap;
    if (cut) guide = guide.slice(0, cap);
    var note = cut ? "\n[The guide was cut after " + cap + " characters; open the link above with a GET for the rest.]" : "";
    return { text: prompt + "\n\n" + GUIDE_START + "\n" + guide + note + "\n" + GUIDE_END, cut: cut, withGuide: true };
  }

  var api = { extractLink: extractLink, buildSmallPrompt: buildSmallPrompt, buildMessage: buildMessage, MAX_GUIDE_CHARS: MAX_GUIDE_CHARS, GUIDE_START: GUIDE_START, GUIDE_END: GUIDE_END };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PROJEXA_AI_LINK_LIB = api;
})(typeof window !== "undefined" ? window : this);
