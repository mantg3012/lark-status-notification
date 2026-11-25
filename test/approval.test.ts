import { describe, expect, it, vi } from "vitest";
import {
  getInstance,
  listInstanceCodes,
  subscribeApproval,
} from "../src/lark/approval";
import type { LarkClient, RequestOptions } from "../src/lark/client";

function makeMockClient(
  impl: (method: "GET" | "POST", path: string, opts?: RequestOptions) => Promise<unknown>,
) {
  const request = vi.fn(impl);
  const client: LarkClient = {
    request: request as LarkClient["request"],
  };
  return { client, request };
}

describe("approval API", () => {
  it("listInstanceCodes merges 2 pages, passes page_token on page 2, and formats times as strings", async () => {
    const { client, request } = makeMockClient(async (_method, _path, opts) => {
      if (!opts?.query?.page_token) {
        return {
          instance_code_list: ["inst_1", "inst_2"],
          has_more: true,
          page_token: "next_tok",
        };
      }
      return {
        instance_code_list: ["inst_3"],
        has_more: false,
      };
    });

    const codes = await listInstanceCodes(client, "APP_CODE_1", 1700000000000, 1700086400000);

    expect(codes).toEqual(["inst_1", "inst_2", "inst_3"]);
    expect(request).toHaveBeenCalledTimes(2);

    expect(request.mock.calls[0][0]).toBe("GET");
    expect(request.mock.calls[0][1]).toBe("/approval/v4/instances");
    expect(request.mock.calls[0][2]?.query).toEqual({
      approval_code: "APP_CODE_1",
      start_time: "1700000000000",
      end_time: "1700086400000",
      page_size: 100,
      page_token: undefined,
    });
    expect(typeof request.mock.calls[0][2]?.query?.start_time).toBe("string");
    expect(typeof request.mock.calls[0][2]?.query?.end_time).toBe("string");

    expect(request.mock.calls[1][2]?.query?.page_token).toBe("next_tok");
  });

  it("listInstanceCodes returns [] when instance_code_list is missing", async () => {
    const { client } = makeMockClient(async () => ({ has_more: false }));
    expect(await listInstanceCodes(client, "APP_CODE_1", 100, 200)).toEqual([]);
  });

  it("getInstance encodes instanceCode in path and falls back to param if missing in response", async () => {
    const { client, request } = makeMockClient(async () => ({
      approval_code: "APP_CODE_1",
      status: "APPROVED",
      open_id: "ou_123",
      form: "[]",
    }));

    const inst = await getInstance(client, "a/b");

    expect(request).toHaveBeenCalledWith("GET", "/approval/v4/instances/a%2Fb");
    expect(inst.instance_code).toBe("a/b");
    expect(inst.status).toBe("APPROVED");
  });

  it("subscribeApproval sends POST to encoded subscribe path with empty body", async () => {
    const { client, request } = makeMockClient(async () => ({}));

    await subscribeApproval(client, "app/1");

    expect(request).toHaveBeenCalledWith(
      "POST",
      "/approval/v4/approvals/app%2F1/subscribe",
      { body: {} },
    );
  });
});
