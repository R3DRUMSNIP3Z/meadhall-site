import {
  getGlobalHistory,
  openGlobalStream,
  sendGlobalMessage,
  startGlobalPolling,
  API_BASE as BASE_FROM_HELPER,
} from "./chatGlobal.js";

function pickApiBase() {
  const meta = document.querySelector('meta[name="api-base"]');
  return (meta?.content?.trim() || BASE_FROM_HELPER || "");
}
const API_BASE = pickApiBase();

// ------------------- User -------------------
const LS_KEY_MAIN = "mh_user";
const LS_KEY_FALLBACK = "user";
const DEFAULT_AVATAR = "/logo/logo-512.png";

function getUser() {
  try {
    return (
      JSON.parse(localStorage.getItem(LS_KEY_MAIN)) ||
      JSON.parse(localStorage.getItem(LS_KEY_FALLBACK))
    );
  } catch {
    return null;
  }
}
function setUser(u) {
  localStorage.setItem(LS_KEY_MAIN, JSON.stringify(u));
  localStorage.removeItem(LS_KEY_FALLBACK);
}
async function loadUserFresh(u) {
  if (!API_BASE || !u?.id) return u;
  try {
    const r = await fetch(`${API_BASE}/api/users/${u.id}`);
    if (!r.ok) throw new Error(await r.text());
    const fresh = await r.json();
    setUser(fresh);
    return fresh;
  } catch {
    return u;
  }
}
let CURRENT_USER = getUser();
(async () => {
  if (CURRENT_USER?.id) CURRENT_USER = await loadUserFresh(CURRENT_USER);
})();

// ------------------- Chat DOM -------------------
const chatBox = document.getElementById("chatBox");
const input = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

const seen = new Set();
function parseMessage(text) {
  return String(text).replace(
    /(?:https?:\/\/\S+|data:image\/(?:png|webp|gif);base64,[A-Za-z0-9+/=]+)/gi,
    (u) => {
      const isImage =
        /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(u) ||
        /giphy\.com/i.test(u) ||
        /^data:image\/(?:png|webp|gif);base64,/i.test(u);
      if (isImage) {
        return `<img src="${u}" style="max-width:220px;display:block;margin-top:6px;border-radius:8px;border:1px solid #3b3325;"/>`;
      }
      return `<a href="${u}" target="_blank" rel="noopener">${u}</a>`;
    }
  );
}
function renderMsg(msg) {
  if (msg?.id && seen.has(msg.id)) return;
  if (msg?.id) seen.add(msg.id);
  const u = msg.user || {};
  const name = u.name || "skald";
  const avatar = u.avatarUrl || DEFAULT_AVATAR;
  const profile = u.id ? `/profile/${u.id}` : "/account.html";
  const row = document.createElement("div");
  row.className = "msg";
  row.innerHTML = `
    <img class="avatar" src="${avatar}" alt="${name}" onclick="window.location='${profile}'"/>
    <div class="bubble">
      <div class="meta">${name}</div>
      ${parseMessage(msg.text || "")}
    </div>`;
  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function renderSystem(text) {
  const p = document.createElement("div");
  p.className = "sys";
  p.textContent = text;
  chatBox.appendChild(p);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ------------------- History + Stream -------------------
let lastId = "";
(async () => {
  try {
    const list = await getGlobalHistory(lastId);
    list.forEach((m) => {
      renderMsg(m);
      lastId = m.id;
    });
  } catch {
    renderSystem("⚠️ Could not load history.");
  }

  if ("EventSource" in window) {
    openGlobalStream(
      (m) => {
        renderMsg(m);
        lastId = m.id;
      },
      () => renderSystem("Connected to the mead fire."),
      () => renderSystem("⚠️ Stream error — falling back if needed")
    );
  } else {
    const ref = { current: lastId };
    startGlobalPolling(ref, (batch) =>
      batch.forEach((m) => {
        renderMsg(m);
        ref.current = m.id || ref.current;
      })
    );
    renderSystem("⚠️ No EventSource — using polling.");
  }
})();

// ------------------- Send -------------------
sendBtn.onclick = async () => {
  const text = input.value.trim();
  if (!text) return;
  sendBtn.disabled = true;
  try {
    await sendGlobalMessage(CURRENT_USER?.id ?? null, text);
    input.value = "";
  } catch {
    renderSystem("⚠️ Message failed to send.");
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
};

