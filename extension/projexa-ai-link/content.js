// PROJEXA AI Link (Audit 37, point 36). Adds a small "PROJEXA" button to chat AI pages. One click puts the saved PROJEXA AI prompt (the text
// PROJEXA's "AI prompt - paste in any AI" button copies, which contains the work link) into the chat box. The person sends it themselves.
// Nothing leaves the browser: the prompt is read from the extension's own storage, written into the page's chat box, never sent anywhere.
(function () {
  if (window.__projexaAiLink) return;
  window.__projexaAiLink = true;

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
    var old = button.textContent;
    button.textContent = msg;
    setTimeout(function () { button.textContent = old; }, 2500);
  }

  function addButton() {
    if (document.getElementById("projexa-ai-link-btn")) return;
    var b = document.createElement("button");
    b.id = "projexa-ai-link-btn";
    b.type = "button";
    b.textContent = "PROJEXA";
    b.title = "Put my PROJEXA AI prompt in the chat box";
    b.style.cssText = "position:fixed;right:16px;bottom:96px;z-index:2147483647;padding:8px 12px;border:0;border-radius:999px;" +
      "background:#f5820a;color:#1c2b3a;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)";
    b.addEventListener("click", function () {
      chrome.storage.local.get("prompt", function (r) {
        var text = r && r.prompt;
        if (!text) { toast(b, "Open the PROJEXA extension and paste your prompt once"); return; }
        var box = findBox();
        if (!box) { toast(b, "No chat box found on this page"); return; }
        toast(b, putText(box, text) ? "Prompt added - press send" : "Could not add it");
      });
    });
    document.body.appendChild(b);
  }

  addButton();
  new MutationObserver(addButton).observe(document.documentElement, { childList: true, subtree: true });
})();
