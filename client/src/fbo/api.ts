import { QueryClient } from "@tanstack/react-query";

/** FBO portal session token. Separate key from the crew app, and usually a separate origin (fbo. host). */
const KEY = "wheelsdown-fbo-token";
let TOKEN = (() => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } })();
export const fboToken = () => TOKEN;
export function setFboToken(t: string) {
  TOKEN = t;
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(method: string, url: string, data?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...(data !== undefined ? { "Content-Type": "application/json" } : {}), ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    if (res.status === 401 && TOKEN && !url.includes("/login")) { setFboToken(""); fboQuery.clear(); window.dispatchEvent(new Event("fbo-signed-out")); }
    throw new ApiError(res.status, (body && body.message) || res.statusText || "Something went wrong");
  }
  return body as T;
}
export const get = <T,>(url: string) => () => api<T>("GET", url);

export const fboQuery = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: false, refetchOnWindowFocus: false } } });
