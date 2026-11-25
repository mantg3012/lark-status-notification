export class LarkApiError extends Error {
  constructor(
    public code: number,
    public msg: string,
    public httpStatus: number,
    public path: string,
  ) {
    super(`Lark API error ${code} on ${path} (HTTP ${httpStatus}): ${msg}`);
    this.name = "LarkApiError";
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export interface LarkClient {
  request<T>(method: "GET" | "POST", path: string, opts?: RequestOptions): Promise<T>;
}

const RETRY_DELAYS_MS = [1000, 2000];
const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(httpStatus: number, code: number): boolean {
  if (httpStatus === 429) return true;
  if (httpStatus >= 500 && httpStatus < 600) return true;
  // TODO verify rate-limit code
  if (code === 99991400) return true;
  return false;
}

function buildUrl(
  domain: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const base = `${domain.replace(/\/+$/, "")}/open-apis${path}`;
  if (!query) return base;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function createLarkClient(
  domain: string,
  token: string,
  fetchFn: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = DEFAULT_SLEEP,
): LarkClient {
  return {
    async request<T>(method: "GET" | "POST", path: string, opts?: RequestOptions): Promise<T> {
      const url = buildUrl(domain, path, opts?.query);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      let bodyStr: string | undefined;
      if (opts?.body !== undefined) {
        headers["Content-Type"] = "application/json; charset=utf-8";
        bodyStr = JSON.stringify(opts.body);
      }

      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        const res = await fetchFn(url, {
          method,
          headers,
          body: bodyStr,
        });

        let parsed: { code?: unknown; msg?: unknown; data?: T } | null = null;
        try {
          parsed = (await res.json()) as { code?: unknown; msg?: unknown; data?: T };
        } catch {
          const err = new LarkApiError(-1, `Invalid JSON response (HTTP ${res.status})`, res.status, path);
          if (attempt < RETRY_DELAYS_MS.length && isRetryable(res.status, -1)) {
            await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          throw err;
        }

        const code = typeof parsed?.code === "number" ? parsed.code : -1;
        const msg = typeof parsed?.msg === "string" ? parsed.msg : res.statusText || "Unknown error";

        if (code !== 0 || !res.ok) {
          const err = new LarkApiError(code, msg, res.status, path);
          if (attempt < RETRY_DELAYS_MS.length && isRetryable(res.status, code)) {
            await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          throw err;
        }

        return parsed.data as T;
      }

      throw new LarkApiError(-1, "Unexpected retry exhaustion", 0, path);
    },
  };
}
