
function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r)));
}

function showStatus(text, ok) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = `status show ${ok ? "ok" : "err"}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const res = await send({ type: "GET_SETTINGS" });
  const s = res.data || {
    apiUrl: "http://127.0.0.1:3030",
    apiKey: "",
    defaultActor: "browser-user",
    autoCapture: false,
    injectIntoAiChats: false,
    headroomMode: true,
  };

  document.getElementById("apiUrl").value = s.apiUrl;
  document.getElementById("apiKey").value = s.apiKey;
  document.getElementById("defaultActor").value = s.defaultActor;
  document.getElementById("autoCapture").checked = s.autoCapture;
  document.getElementById("injectIntoAiChats").checked = s.injectIntoAiChats;
  document.getElementById("headroomMode").checked = s.headroomMode;

  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const settings = {
      apiUrl: document.getElementById("apiUrl").value.trim(),
      apiKey: document.getElementById("apiKey").value.trim(),
      defaultActor: document.getElementById("defaultActor").value.trim() || "browser-user",
      autoCapture: document.getElementById("autoCapture").checked,
      injectIntoAiChats: document.getElementById("injectIntoAiChats").checked,
      headroomMode: document.getElementById("headroomMode").checked,
    };
    const r = await send({ type: "SAVE_SETTINGS", settings });
    if (r.success) showStatus("Settings saved", true);
    else showStatus(r.error || "Save failed", false);
  });

  document.getElementById("btn-test").addEventListener("click", async () => {
    const settings = {
      apiUrl: document.getElementById("apiUrl").value.trim(),
      apiKey: document.getElementById("apiKey").value.trim(),
    };
    await send({ type: "SAVE_SETTINGS", settings });
    const r = await send({ type: "HEALTH_CHECK" });
    if (r.success && r.data?.healthy) {
      showStatus(`Connected — ${r.data.status}${r.data.service ? " (" + r.data.service + ")" : ""}`, true);
    } else {
      showStatus(r.error || "Unreachable. Is hipcortex start running?", false);
    }
  });
});
