/**
 * Resolve the API base URL in a deployment-safe order.
 *
 * 1. Runtime window config (useful for Railway/Docker without rebuilding the SPA)
 * 2. Vite build-time VITE_API_URL
 * 3. Same-origin /api (the production nginx proxy handles this)
 */
export function getApiBaseUrl(): string {
  const runtime = typeof window !== 'undefined'
    ? (window as Window & { __EXAM_CONFIG__?: { apiBaseUrl?: string } }).__EXAM_CONFIG__?.apiBaseUrl
    : undefined;
  const buildTime = typeof import.meta !== 'undefined' ? (import.meta.env.VITE_API_URL as string | undefined) : undefined;
  return String(runtime ?? buildTime ?? '').trim().replace(/\/$/, '');
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}

export async function request<T>(path:string, init?:RequestInit):Promise<T>{
  const response=await fetch(apiUrl(path),{...init,credentials:"include",headers:{"content-type":"application/json",...(init?.headers??{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body?.error?.message??`HTTP_${response.status}`);
  return body as T;
}
