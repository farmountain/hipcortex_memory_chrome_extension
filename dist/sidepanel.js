function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r)));
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function refreshHealth() {
  const el = document.getElementById("status");
  const r = await send({ type: "HEALTH_CHECK" });
  if (r.success && r.data?.healthy) {
    el.textContent = "online";
    el.className = "badge healthy";
  } else {
    el.textContent = "offline";
    el.className = "badge unhealthy";
  }
}

function render(data) {
  const box = document.getElementById("results");
  box.innerHTML = "";
  if (!data.results?.length) {
    box.innerHTML = `<div class="result" style="color:var(--muted)">No matching memories</div>`;
    return;
  }
  for (const r of data.results) {
    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `
      <div class="meta"><strong>${escapeHtml(r.actor || "?")}</strong> · ${escapeHtml(r.action || "")}</div>
      <div class="target">${escapeHtml(r.target || "")}</div>
    `;
    box.appendChild(div);
  }
}

async function doSearch(q) {
  if (!q.trim()) return;
  const r = await send({ type: "SEARCH_MEMORY", query: q.trim(), limit: 20 });
  if (r.success && r.data) render(r.data);
}

document.addEventListener("DOMContentLoaded", async () => {
  await refreshHealth();

  const session = await chrome.storage.session.get("pendingSearch");
  if (session.pendingSearch) {
    document.getElementById("query").value = session.pendingSearch;
    await doSearch(session.pendingSearch);
    await chrome.storage.session.remove("pendingSearch");
  }

  document.getElementById("btn-search").addEventListener("click", () => {
    doSearch(document.getElementById("query").value);
  });
  document.getElementById("query").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch(e.target.value);
  });

  document.getElementById("btn-capture").addEventListener("click", async () => {
    const text = document.getElementById("capture").value.trim();
    if (!text) return;
    const settings = (await send({ type: "GET_SETTINGS" })).data;
    const r = await send({
      type: "ADD_MEMORY",
      record: {
        actor: settings?.defaultActor || "browser-user",
        action: "noted",
        target: text,
        metadata: { source: "sidepanel" },
      },
    });
    if (r.success) {
      document.getElementById("capture").value = "";
    }
  });
});
