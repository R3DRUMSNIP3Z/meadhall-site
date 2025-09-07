// Central API config (URL + headers)
export const API_BASE =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content ||
  (window as any).VITE_API_BASE ||
  import.meta.env.VITE_API_BASE ||
  "http://localhost:5050";

export function authHeaders(userId: string) {
  return { "Content-Type": "application/json", "x-user-id": userId };
}



