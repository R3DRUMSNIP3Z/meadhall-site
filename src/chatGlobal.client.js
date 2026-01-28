// Browser-side helper for Mead Hall global chat
function pickApiBase() {
  const meta = document.querySelector('meta[name="api-base"]');
  const v = (meta?.content || "").trim();
  return v || "https://meadhall-site.onrender.com"; // your Render backend
}
const API = pickApiBase().replace(/\/+$/, "");

// --- Load message history ---
export async function getGlobalHistory(since = "") {
  const url = new URL(`${API}/api/chat/global`);
  if (since) url.searchParams.set("since", since);
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// --- Open live event stream ---
export function openGlobalStream(onMessage) {
  const es = new EventSource(`${API}/api/chat/global/stream`);
  es.onmessage = (ev) => {
    try { onMessage(JSON.parse(ev.data)); } catch {}
  };
  return () => es.close();
}

// --- Send new message ---
export async function sendGlobalMessage(userId, text) {
  const r = await fetch(`${API}/api/chat/global`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, text }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
