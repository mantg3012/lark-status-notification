import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config";
import worker from "../src/index";
import type { ScheduleStore } from "../src/schedule";

const VERIFY = "test-verification"; // fake value for tests

const fakeStore: ScheduleStore = {
  async put() {},
  async delete() {},
  async list() {
    return { keys: [], list_complete: true };
  },
};

function makeValidEnv(overrides: Partial<Env> = {}): Env {
  return {
    LARK_APP_ID: "cli_test_app_id",
    LARK_APP_SECRET: "super_secret_value_123",
    LARK_ENCRYPT_KEY: "",
    LARK_VERIFICATION_TOKEN: VERIFY,
    LARK_DOMAIN: "https://open.larksuite.com",
    TIMEZONE: "Asia/Ho_Chi_Minh",
    SCAN_LOOKBACK_DAYS: "60",
    APPROVAL_MAPPING: JSON.stringify({
      CODE_REMOTE: { statusTitle: "Remote", startField: "w1", endField: "w1" },
    }),
    SCHEDULE: fakeStore,
    ...overrides,
  };
}

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

describe("worker fetch handler", () => {
  it("returns 404 for GET /lark/events and POST /other", async () => {
    const env = makeValidEnv();

    const resGet = await worker.fetch(
      new Request("https://worker.example/lark/events", { method: "GET" }),
      env,
      ctx,
    );
    expect(resGet.status).toBe(404);

    const resOther = await worker.fetch(
      new Request("https://worker.example/other", { method: "POST", body: "{}" }),
      env,
      ctx,
    );
    expect(resOther.status).toBe(404);
  });

  it("returns 200 with challenge JSON for valid url_verification", async () => {
    const env = makeValidEnv();
    const res = await worker.fetch(
      new Request("https://worker.example/lark/events", {
        method: "POST",
        body: JSON.stringify({
          type: "url_verification",
          token: VERIFY,
          challenge: "my_challenge",
        }),
      }),
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "my_challenge" });
  });

  it("returns 401 for bad token and 400 for malformed body", async () => {
    const env = makeValidEnv();

    const resBadToken = await worker.fetch(
      new Request("https://worker.example/lark/events", {
        method: "POST",
        body: JSON.stringify({
          type: "url_verification",
          token: "wrong_token",
          challenge: "my_challenge",
        }),
      }),
      env,
      ctx,
    );
    expect(resBadToken.status).toBe(401);

    const resBadBody = await worker.fetch(
      new Request("https://worker.example/lark/events", {
        method: "POST",
        body: "not-json",
      }),
      env,
      ctx,
    );
    expect(resBadBody.status).toBe(400);
  });

  it("returns 200 and logs when approval event matches APPROVAL_MAPPING", async () => {
    const env = makeValidEnv();
    const waitUntil = vi.fn();
    const localCtx = {
      waitUntil,
      passThroughOnException() {},
    } as unknown as ExecutionContext;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise(() => {}));

    try {
      const res = await worker.fetch(
        new Request("https://worker.example/lark/events", {
          method: "POST",
          body: JSON.stringify({
            schema: "2.0",
            header: {
              token: VERIFY,
              event_type: "approval_instance",
            },
            event: {
              approval_code: "CODE_REMOTE",
              instance_code: "INST_99",
              status: "APPROVED",
            },
          }),
        }),
        env,
        localCtx,
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({});
      expect(waitUntil).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
        action: "event_received",
        instance_code: "INST_99",
        approval_code: "CODE_REMOTE",
        status: "APPROVED",
      });
    } finally {
      fetchSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
