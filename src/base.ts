export const API = (import.meta.env.VITE_API_BASE ?? window.location.origin).replace(/\/+$/,"");

async function send(method: string, path: string, body?: any) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : r.text();
}

export const post = (p: string, b: any) => send("POST", p, b);
export const get  = (p: string)       => send("GET", p);
