import { describe, expect, it, vi } from "vitest";
import { getTenantAccessToken } from "../src/lark/auth";
import { createLarkClient, LarkApiError } from "../src/lark/client";

const noopSleep = async () => {};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("LarkClient", () => {
  it("returns data on code 0 and sends query params and Authorization header", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ code: 0, msg: "ok", data: { items: [1, 2] } }),
    );
    const client = createLarkClient("https://open.larksuite.com/", "t_abc", fetchMock, noopSleep);

    const data = await client.request<{ items: number[] }>("GET", "/personal_settings/v1/system_statuses", {
      query: { page_size: 20, page_token: undefined },
    });

    expect(data).toEqual({ items: [1, 2] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://open.larksuite.com/open-apis/personal_settings/v1/system_statuses?page_size=20");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer t_abc");
  });

  it("throws LarkApiError without retrying on non-retryable code 99991663", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ code: 99991663, msg: "Invalid token" }, 200),
    );
    const client = createLarkClient("https://open.larksuite.com", "bad", fetchMock, noopSleep);

    await expect(client.request("GET", "/test")).rejects.toMatchObject({
      name: "LarkApiError",
      code: 99991663,
      msg: "Invalid token",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on HTTP 429 and returns data on second attempt", async () => {
    const sleepMock = vi.fn(noopSleep);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 99991400, msg: "rate limit" }, 429))
      .mockResolvedValueOnce(jsonResponse({ code: 0, msg: "ok", data: { ok: true } }, 200));

    const client = createLarkClient("https://open.larksuite.com", "t_abc", fetchMock, sleepMock);
    const data = await client.request<{ ok: boolean }>("POST", "/test", { body: { a: 1 } });

    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(1000);
  });

  it("retries up to 3 total attempts on HTTP 500 and then throws LarkApiError", async () => {
    const sleepMock = vi.fn(noopSleep);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ code: 500, msg: "Internal Error" }, 500),
    );

    const client = createLarkClient("https://open.larksuite.com", "t_abc", fetchMock, sleepMock);

    await expect(client.request("GET", "/test")).rejects.toBeInstanceOf(LarkApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
  });
});

describe("getTenantAccessToken", () => {
  it("reads top-level tenant_access_token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        code: 0,
        msg: "ok",
        tenant_access_token: "t-g104_test_token",
        expire: 7200,
      }),
    );

    const token = await getTenantAccessToken(
      "https://open.larksuite.com",
      "cli_app",
      "secret",
      fetchMock,
    );

    expect(token).toBe("t-g104_test_token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal");
    expect(init?.method).toBe("POST");
  });

  it("throws LarkApiError when code != 0", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ code: 10003, msg: "invalid app_id" }, 200),
    );

    await expect(
      getTenantAccessToken("https://open.larksuite.com", "bad", "secret", fetchMock),
    ).rejects.toMatchObject({
      name: "LarkApiError",
      code: 10003,
      msg: "invalid app_id",
    });
  });
});
