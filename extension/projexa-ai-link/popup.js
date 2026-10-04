var L = window.PROJEXA_AI_LINK_LIB;
var t = document.getElementById("t");
var msg = document.getElementById("msg");
function say(s) { msg.textContent = s; setTimeout(function () { msg.textContent = ""; }, 2500); }
// Only the LINK is stored (extracted from whatever was pasted: the link alone or a whole prompt).
function saveFrom(text) {
  var link = L.extractLink(text);
  if (!link) { say("No PROJEXA link found in that text"); return; }
  t.value = link;
  chrome.storage.local.set({ link: link }, function () { chrome.storage.local.remove("prompt"); say("Saved"); });
}
chrome.storage.local.get(["link", "prompt"], function (r) {
  var link = (r && r.link) || L.extractLink(r && r.prompt);
  if (link) t.value = link;
});
document.getElementById("save").addEventListener("click", function () { saveFrom(t.value); });
document.getElementById("paste").addEventListener("click", function () {
  navigator.clipboard.readText().then(saveFrom, function () { say("Allow clipboard access"); });
});
