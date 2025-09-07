// src/chatGlobal.ts
// Global chat API â€” history, live stream (SSE), send message

import { API_BASE } from "./base";

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

/** Fetch history after a message id (pass "" for full). */
export async function getGlobalHistory(sinceId: string = ""): Promise<GlobalMsg[]> {
  const r = await fetch(`${API_BASE}/api/chat/global?since=${encodeURIComponent(sinceId)}`);
  if (!r.ok) throw new Error(`global history failed: ${r.status}`);
  return r.json() as Promise<GlobalMsg[]>;
}

/** Open an SSE connection to global chat.
 * Returns a function you can call to close the stream. */
export function openGlobalStream(
  onMessage: (msg: GlobalMsg) => void,
  onOpen?: () => void,
  onError?: (err: any) => void
) {
  const es = new EventSource(`${API_BASE}/api/chat/global/stream`);
  es.onopen = () => onOpen?.();
  es.onerror = (e) => onError?.(e);
  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as GlobalMsg;
      onMessage(msg);
    } catch {
      /* ignore invalid events */
    }
  };
  return () => es.close();
}

/** Send a message to the global chat. */
export async function sendGlobalMessage(userId: string | null, text: string) {
  const r = await fetch(`${API_BASE}/api/chat/global`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, text }),
  });
  if (!r.ok) throw new Error(`global send failed: ${r.status}`);
  return r.json() as Promise<{ ok: true; id: string }>;
}

/** Optional polling fallback if EventSource isnâ€™t available. */
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
    } catch { /* ignore errors */ }
  };
  timer = setInterval(tick, intervalMs);
  tick(); // immediate
  return () => { if (timer) clearInterval(timer); };
}


