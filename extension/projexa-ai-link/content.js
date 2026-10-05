// PROJEXA AI Link (Audit 37, point 36). Adds a small "PROJEXA" button to chat AI pages. One click fetches the person's own PROJEXA guide
// (a plain GET of their saved work link) and puts ONE message in the chat box: the small prompt plus the guide, so even an AI that cannot
// open links has everything. The person sends it themselves. The only network request is that one GET; nothing else leaves the browser.
(function () {
  if (window.__projexaAiLink) return;
  window.__projexaAiLink = true;

  var L = window.PROJEXA_AI_LINK_LIB; // lib.js is loaded first by the manifest
  if (!L) return;

  // One selector per site. `site` names whose message box the selector was written for and `hosts` where that site lives: on a site's own
  // host its own selector is tried FIRST, then every other one in list order as a fallback (z.ai and DeepSeek both call their box
  // textarea#chat-input, live 2026-10-05). The button records which selector found the box (data-box), so a test can tell "found by its own
  // selector" from "found by another site's selector by luck", and scripts/verify/chat-site-selectors.mjs reads this list to check every
  // selector against the live sites.
  var BOX_SELECTORS = [
    { site: "chatgpt", hosts: ["chatgpt.com", "chat.openai.com"], css: "#prompt-textarea" },
    { site: "claude", hosts: ["claude.ai"], css: 'div.ProseMirror[contenteditable="true"]' },
    { site: "gemini", hosts: ["gemini.google.com"], css: "rich-textarea div[contenteditable=true]" },
    { site: "deepseek", hosts: ["chat.deepseek.com"], css: "textarea#chat-input" },
    { site: "zai", hosts: ["chat.z.ai"], css: "form textarea#chat-input" },
    { site: "generic", hosts: [], css: 'textarea[placeholder], div[contenteditable="true"][role="textbox"]' }
  ];

  function orderFor(host) {
    var own = [], rest = [];
    for (var i = 0; i < BOX_SELECTORS.length; i++) (BOX_SELECTORS[i].hosts.indexOf(host) >= 0 ? own : rest).push(BOX_SELECTORS[i]);
    return own.concat(rest);
  }

  function findBox() {
    var list = orderFor(location.hostname);
    for (var i = 0; i < list.length; i++) {
      var el = document.querySelector(list[i].css);
      if (el) return { el: el, site: list[i].site };
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
        var found = findBox();
        if (!found) { toast(b, "No chat box found on this page"); return; }
        var box = found.el;
        b.dataset.box = found.site;
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
