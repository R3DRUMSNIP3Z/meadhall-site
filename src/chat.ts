import { API_BASE, authHeaders } from "./base";

export async function getHistory(userId: string, withId: string) {
  const r = await fetch(`${API_BASE}/api/chat/history?with=${encodeURIComponent(withId)}`, {
    headers: authHeaders(userId),
  });
  if (!r.ok) throw new Error("history failed");
  return r.json() as Promise<Array<{from:string;to:string;text:string;ts:number}>>;
}

export async function sendMessage(userId: string, to: string, text: string) {
  const r = await fetch(`${API_BASE}/api/chat/send`, {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({ to, text }),
  });
  if (!r.ok) throw new Error("send failed");
  return r.json();
}

