import { describe, expect, it } from "vitest";
import { loadConfig, type Env } from "../src/config";
import type { ScheduleStore } from "../src/schedule";

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
    LARK_ENCRYPT_KEY: "encrypt_key_value",
    LARK_VERIFICATION_TOKEN: "verify_token_value",
    LARK_DOMAIN: "https://open.larksuite.com/",
    TIMEZONE: "Asia/Ho_Chi_Minh",
    SCAN_LOOKBACK_DAYS: "60",
    APPROVAL_MAPPING: JSON.stringify({
      CODE_REMOTE: { statusTitle: "Remote", startField: "w1", endField: "w1" },
      CODE_OFF: { statusTitle: "Off", startField: "w2", endField: "w3" },
    }),
    SCHEDULE: fakeStore,
    ...overrides,
  };
}

describe("loadConfig", () => {
  it("parses valid env, strips trailing slash, and maps 2 approval entries", () => {
    const cfg = loadConfig(makeValidEnv());
    expect(Object.keys(cfg.approvalMapping)).toHaveLength(2);
    expect(cfg.approvalMapping.CODE_REMOTE).toEqual({
      statusTitle: "Remote",
      startField: "w1",
      endField: "w1",
    });
    expect(cfg.scanLookbackDays).toBe(60);
    expect(cfg.domain).toBe("https://open.larksuite.com");
    expect(cfg.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(cfg.encryptKey).toBe("encrypt_key_value");
  });

  it("defaults encryptKey to empty string and timezone to Asia/Ho_Chi_Minh", () => {
    const cfg = loadConfig(
      makeValidEnv({ LARK_ENCRYPT_KEY: undefined, TIMEZONE: "" }),
    );
    expect(cfg.encryptKey).toBe("");
    expect(cfg.timezone).toBe("Asia/Ho_Chi_Minh");
  });

  it("throws when APPROVAL_MAPPING has invalid JSON", () => {
    expect(() => loadConfig(makeValidEnv({ APPROVAL_MAPPING: "{bad json" }))).toThrow();
  });

  it("throws when an APPROVAL_MAPPING entry is missing endField", () => {
    expect(() =>
      loadConfig(
        makeValidEnv({
          APPROVAL_MAPPING: JSON.stringify({
            CODE_REMOTE: { statusTitle: "Remote", startField: "w1" },
          }),
        }),
      ),
    ).toThrow();
  });

  it("throws when SCAN_LOOKBACK_DAYS is not a positive integer", () => {
    expect(() => loadConfig(makeValidEnv({ SCAN_LOOKBACK_DAYS: "0" }))).toThrow();
    expect(() => loadConfig(makeValidEnv({ SCAN_LOOKBACK_DAYS: "-5" }))).toThrow();
    expect(() => loadConfig(makeValidEnv({ SCAN_LOOKBACK_DAYS: "abc" }))).toThrow();
  });

  it("throws when LARK_APP_ID is missing without leaking secret values", () => {
    let caught: Error | undefined;
    try {
      loadConfig(makeValidEnv({ LARK_APP_ID: "" }));
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain("LARK_APP_ID");
    expect(caught?.message).not.toContain("super_secret_value_123");
    expect(caught?.message).not.toContain("verify_token_value");
  });
});
