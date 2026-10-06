import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const IS_STATIC = import.meta.env.VITE_STATIC === "1";
const mock = () => import("./mockApi");

// Anonymous per-device id so each crew member gets one vote per listing.
export const VOTER_ID: string = (() => {
  const make = () => "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    const k = "wheelsdown-voter";
    const v = window.localStorage.getItem(k) || make();
    window.localStorage.setItem(k, v);
    return v;
  } catch {
    return make();
  }
})();

// Session token for signed-in crew (kept in memory; persisted when the browser allows it).
const TOKEN_KEY = "wheelsdown-token";
let AUTH_TOKEN = (() => { try { return window.localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } })();
export const getAuthToken = () => AUTH_TOKEN;
export function setAuthToken(t: string) {
  AUTH_TOKEN = t;
  try { t ? window.localStorage.setItem(TOKEN_KEY, t) : window.localStorage.removeItem(TOKEN_KEY); } catch {}
}
const authHeaders = (): Record<string, string> => (AUTH_TOKEN ? { authorization: `Bearer ${AUTH_TOKEN}` } : {});

export const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  if (IS_STATIC) {
    const res = await (await mock()).mockFetch(method, url, data, { "x-voter-id": VOTER_ID, ...authHeaders(), ...extraHeaders });
    await throwIfResNotOk(res);
    return res;
  }
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: { ...(data ? { "Content-Type": "application/json" } : {}), "x-voter-id": VOTER_ID, ...authHeaders(), ...extraHeaders },
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const path = queryKey.join("/");
    const res = IS_STATIC ? await (await mock()).mockFetch("GET", path, undefined, { "x-voter-id": VOTER_ID, ...authHeaders() }) : await fetch(`${API_BASE}${path}`, { headers: { "x-voter-id": VOTER_ID, ...authHeaders() } });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
