import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LarkClient, RequestOptions } from "../src/lark/client";
import {
  batchClose,
  batchOpen,
  clearStatusCache,
  createSystemStatus,
  listSystemStatuses,
  resolveStatusId,
} from "../src/lark/status";

function makeMockClient(
  impl: (method: "GET" | "POST", path: string, opts?: RequestOptions) => Promise<unknown>,
) {
  const request = vi.fn(impl);
  const client: LarkClient = {
    request: request as LarkClient["request"],
  };
  return { client, request };
}

describe("system status API", () => {
  beforeEach(() => {
    clearStatusCache();
  });

  it("listSystemStatuses paginates across 2 pages and merges items", async () => {
    const { client, request } = makeMockClient(async (_method, _path, opts) => {
      if (!opts?.query?.page_token) {
        return {
          items: [{ system_status_id: "s1", title: "Remote", icon_key: "GeneralWorkFromHome", priority: 1 }],
          has_more: true,
          page_token: "p2",
        };
      }
      return {
        items: [{ system_status_id: "s2", title: "Off", icon_key: "GeneralVacation", priority: 2 }],
        has_more: false,
      };
    });

    const items = await listSystemStatuses(client);

    expect(items).toHaveLength(2);
    expect(items.map((s) => s.system_status_id)).toEqual(["s1", "s2"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][2]?.query?.page_token).toBeUndefined();
    expect(request.mock.calls[1][2]?.query?.page_token).toBe("p2");
  });

  it("resolveStatusId caches results and throws clear error when title is missing", async () => {
    const { client, request } = makeMockClient(async () => ({
      items: [
        { system_status_id: "id_remote", title: "Remote", icon_key: "GeneralWorkFromHome", priority: 1 },
      ],
      has_more: false,
    }));

    expect(await resolveStatusId(client, "Remote")).toBe("id_remote");
    expect(await resolveStatusId(client, "Remote")).toBe("id_remote");
    expect(request).toHaveBeenCalledTimes(1);

    await expect(resolveStatusId(client, "Vacation")).rejects.toThrow("Vacation");
  });

  it("batchOpen chunks 120 users into 50/50/20 with string end_time", async () => {
    const { client, request } = makeMockClient(async (_method, _path, opts) => {
      const body = opts?.body as { user_list: Array<{ user_id: string; end_time: unknown }> };
      return {
        result_list: body.user_list.map((u) => ({
          user_id: u.user_id,
          end_time: String(u.end_time),
          result: "success",
        })),
      };
    });

    const users = Array.from({ length: 120 }, (_, idx) => ({
      user_id: `ou_${idx}`,
      end_time: 1795625999,
    }));

    const results = await batchOpen(client, "st/1", users);

    expect(results).toHaveLength(120);
    expect(request).toHaveBeenCalledTimes(3);
    const sizes = request.mock.calls.map(
      (c) => (c[2]?.body as { user_list: unknown[] }).user_list.length,
    );
    expect(sizes).toEqual([50, 50, 20]);

    const firstCall = request.mock.calls[0];
    expect(firstCall[0]).toBe("POST");
    expect(firstCall[1]).toBe("/personal_settings/v1/system_statuses/st%2F1/batch_open");
    expect(firstCall[2]?.query?.user_id_type).toBe("open_id");
    const firstUser = (firstCall[2]?.body as { user_list: Array<{ end_time: unknown }> }).user_list[0];
    expect(typeof firstUser.end_time).toBe("string");
    expect(firstUser.end_time).toBe("1795625999");
  });

  it("batchOpen returns [] without calling API for empty user list", async () => {
    const { client, request } = makeMockClient(async () => ({}));
    expect(await batchOpen(client, "st_1", [])).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("batchClose chunks 51 users into 2 calls with user_list string[]", async () => {
    const { client, request } = makeMockClient(async (_method, _path, opts) => {
      const body = opts?.body as { user_list: string[] };
      return {
        result_list: body.user_list.map((user_id) => ({ user_id, result: "success" })),
      };
    });

    const userIds = Array.from({ length: 51 }, (_, idx) => `ou_${idx}`);
    const results = await batchClose(client, "st_1", userIds);

    expect(results).toHaveLength(51);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toBe("/personal_settings/v1/system_statuses/st_1/batch_close");
    expect(request.mock.calls[0][2]?.query?.user_id_type).toBe("open_id");
    expect(request.mock.calls[0][2]?.body).toEqual({ user_list: userIds.slice(0, 50) });
    expect(request.mock.calls[1][2]?.body).toEqual({ user_list: userIds.slice(50) });
  });

  it("createSystemStatus posts to system_statuses and returns system_status", async () => {
    const created = {
      system_status_id: "st_new",
      title: "Remote",
      icon_key: "GeneralWorkFromHome",
      priority: 1,
    };
    const { client, request } = makeMockClient(async () => ({ system_status: created }));

    const result = await createSystemStatus(client, {
      title: "Remote",
      icon_key: "GeneralWorkFromHome",
      priority: 1,
    });

    expect(result).toEqual(created);
    expect(request).toHaveBeenCalledWith("POST", "/personal_settings/v1/system_statuses", {
      body: {
        title: "Remote",
        icon_key: "GeneralWorkFromHome",
        priority: 1,
      },
    });
  });
});
