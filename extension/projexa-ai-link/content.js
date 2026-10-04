// PROJEXA AI Link (Audit 37, point 36). Adds a small "PROJEXA" button to chat AI pages. One click fetches the person's own PROJEXA guide
// (a plain GET of their saved work link) and puts ONE message in the chat box: the small prompt plus the guide, so even an AI that cannot
// open links has everything. The person sends it themselves. The only network request is that one GET; nothing else leaves the browser.
(function () {
  if (window.__projexaAiLink) return;
  window.__projexaAiLink = true;

  var L = window.PROJEXA_AI_LINK_LIB; // lib.js is loaded first by the manifest
  if (!L) return;

  var BOX_SELECTORS = [
    "#prompt-textarea",                      // ChatGPT
    'div.ProseMirror[contenteditable="true"]', // Claude
    "rich-textarea div[contenteditable=true]", // Gemini
    "textarea#chat-input",                   // DeepSeek
    'textarea[placeholder], div[contenteditable="true"][role="textbox"]' // generic fallback
  ];

  function findBox() {
    for (var i = 0; i < BOX_SELECTORS.length; i++) {
      var el = document.querySelector(BOX_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  function putText(box, text) {
    box.focus();
    if (box.tagName === "TEXTAREA" || box.tagName === "INPUT") {
      var proto = box.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(box, text); // React-controlled boxes need the native setter
      box.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    // contenteditable (ProseMirror, Quill): insertText fires the editor's own input handling
    document.execCommand("selectAll", false, null);
    return document.execCommand("insertText", false, text);
  }

  function toast(button, msg) {
    button.textContent = msg;
    setTimeout(function () { button.textContent = "PROJEXA"; }, 3500);
  }

  function addButton() {
    if (document.getElementById("projexa-ai-link-btn")) return;
    var b = document.createElement("button");
    b.id = "projexa-ai-link-btn";
    b.type = "button";
    b.textContent = "PROJEXA";
    b.title = "Put my PROJEXA prompt and guide in the chat box";
    b.style.cssText = "position:fixed;right:16px;bottom:96px;z-index:2147483647;padding:8px 12px;border:0;border-radius:999px;" +
      "background:#f5820a;color:#1c2b3a;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)";
    b.addEventListener("click", function () {
      if (b.dataset.busy) return;
      chrome.storage.local.get(["link", "prompt"], function (r) {
        // `prompt` is what version 0.1 saved (a whole pasted prompt); the link is taken out of it.
        var link = (r && r.link) || L.extractLink(r && r.prompt);
        if (!link) { toast(b, "Open the PROJEXA extension and paste your link once"); return; }
        var box = findBox();
        if (!box) { toast(b, "No chat box found on this page"); return; }
        b.dataset.busy = "1";
        b.textContent = "Fetching guide...";
        // The ONE network request this extension makes: a plain GET of the person's own link. The link is never logged.
        fetch(link, { method: "GET", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", headers: { Accept: "text/markdown, text/plain, */*" } })
          .then(function (res) { if (!res.ok) throw new Error("status " + res.status); return res.text(); })
          .then(function (text) { return L.buildMessage(link, text, L.MAX_GUIDE_CHARS); },
                function () { return L.buildMessage(link, null, L.MAX_GUIDE_CHARS); })
          .then(function (m) {
            delete b.dataset.busy;
            var ok = putText(box, m.text);
            toast(b, !ok ? "Could not add it"
              : !m.withGuide ? "Guide not fetched - prompt only. Press send"
              : m.cut ? "Prompt + guide (cut) added - press send"
              : "Prompt + guide added - press send");
          });
      });
    });
    document.body.appendChild(b);
  }

  addButton();
  new MutationObserver(addButton).observe(document.documentElement, { childList: true, subtree: true });
})();
