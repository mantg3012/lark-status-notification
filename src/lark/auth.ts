import { LarkApiError } from "./client";

interface TenantTokenResponse {
  code?: unknown;
  msg?: unknown;
  tenant_access_token?: unknown;
  expire?: unknown;
}

export async function getTenantAccessToken(
  domain: string,
  appId: string,
  appSecret: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const path = "/auth/v3/tenant_access_token/internal";
  const url = `${domain.replace(/\/+$/, "")}/open-apis${path}`;

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });

  let parsed: TenantTokenResponse;
  try {
    parsed = (await res.json()) as TenantTokenResponse;
  } catch {
    throw new LarkApiError(-1, `Invalid JSON response (HTTP ${res.status})`, res.status, path);
  }

  const code = typeof parsed?.code === "number" ? parsed.code : -1;
  const msg = typeof parsed?.msg === "string" ? parsed.msg : res.statusText || "Unknown error";

  if (code !== 0 || !res.ok || typeof parsed.tenant_access_token !== "string") {
    throw new LarkApiError(code, msg, res.status, path);
  }

  return parsed.tenant_access_token;
}
