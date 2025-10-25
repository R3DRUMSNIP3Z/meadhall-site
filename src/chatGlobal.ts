// /src/chatGlobal.ts
// Global chat API — history, live stream (SSE), send message, polling fallback

/* --------------- API BASE --------------- */
// This safely resolves your API base whether local or deployed.
function pickApiBase(): string {
  const meta = (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content?.trim() || "";
  // @ts-ignore vite env available at build
  const vite = (import.meta as any)?.env?.VITE_API_BASE?.trim() || "";
  return meta || vite || "https://meadhall-site.onrender.com";
}
export const API_BASE = pickApiBase();

/* --------------- Types --------------- */
export type GlobalUser = {
  id: string | null;
  name: string;
  avatarUrl: string | null;
};

export type GlobalMsg = {
  id: string;
  text: string;
  createdAt: number;
  user: GlobalUser;
};

/* --------------- Fetch history --------------- */
/** Fetch history after a message id (pass "" for full). */
export async function getGlobalHistory(sinceId: string = ""): Promise<GlobalMsg[]> {
  const r = await fetch(`${API_BASE}/api/chat/global?since=${encodeURIComponent(sinceId)}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`global history failed: ${r.status}`);
  return r.json() as Promise<GlobalMsg[]>;
}

/* --------------- Live stream (SSE) --------------- */
/** Open an SSE connection to global chat.
 * Returns a function you can call to close the stream. */
export function openGlobalStream(
  onMessage: (msg: GlobalMsg) => void,
  onOpen?: () => void,
  onError?: (err: any) => void
) {
  const es = new EventSource(`${API_BASE}/api/chat/global/stream`, { withCredentials: false });
  es.onopen = () => onOpen?.();
  es.onerror = (e) => onError?.(e);
  es.onmessage = (ev) => {
    if (!ev.data) return;
    try {
      const msg = JSON.parse(ev.data) as GlobalMsg;
      if (msg && msg.text) onMessage(msg);
    } catch {
      // ignore malformed lines (like ping events)
    }
  };
  return () => es.close();
}

/* --------------- Send message --------------- */
export async function sendGlobalMessage(userId: string | null, text: string) {
  const r = await fetch(`${API_BASE}/api/chat/global`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, text }),
  });
  if (!r.ok) throw new Error(`global send failed: ${r.status}`);
  return r.json() as Promise<{ ok: true; id: string }>;
}

/* --------------- Polling fallback --------------- */
export function startGlobalPolling(
  sinceIdRef: { current: string },
  onBatch: (msgs: GlobalMsg[]) => void,
  intervalMs = 3000
) {
  let timer: any = null;
  const tick = async () => {
    try {
      const msgs = await getGlobalHistory(sinceIdRef.current || "");
      if (msgs.length) {
        onBatch(msgs);
        sinceIdRef.current = msgs[msgs.length - 1].id || sinceIdRef.current;
      }
    } catch {
      /* ignore fetch errors */
    }
  };
  timer = setInterval(tick, intervalMs);
  tick(); // run immediately
  return () => { if (timer) clearInterval(timer); };
}


