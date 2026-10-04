var t = document.getElementById("t");
var msg = document.getElementById("msg");
function say(s) { msg.textContent = s; setTimeout(function () { msg.textContent = ""; }, 2000); }
chrome.storage.local.get("prompt", function (r) { if (r && r.prompt) t.value = r.prompt; });
document.getElementById("save").addEventListener("click", function () {
  chrome.storage.local.set({ prompt: t.value.trim() }, function () { say("Saved"); });
});
document.getElementById("paste").addEventListener("click", function () {
  navigator.clipboard.readText().then(function (s) { t.value = s; chrome.storage.local.set({ prompt: s.trim() }, function () { say("Saved"); }); }, function () { say("Allow clipboard access"); });
});
