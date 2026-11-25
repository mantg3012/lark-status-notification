import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalConfig, Config } from "../src/config";
import type { ApprovalInstance } from "../src/lark/approval";
import type { LarkClient } from "../src/lark/client";
import { clearStatusCache } from "../src/lark/status";
import {
  listEntries,
  saveEntry,
  type ScheduleEntry,
  type ScheduleStore,
} from "../src/schedule";
import { decide, handleInstance, runDaily } from "../src/sync";

const TZ = "Asia/Ho_Chi_Minh";
const REMOTE_CODE = "72FA0E8B-4446-4E4B-8D05-66F151CE604C";
const OFF_CODE = "72A5FBFF-7F4C-4233-A0E5-E421E1E6276D";

const REMOTE_CFG: ApprovalConfig = {
  statusTitle: "Remote",
  startField: "widget17804706081600001",
  endField: "widget17804706081600001",
};

const OFF_CFG: ApprovalConfig = {
  statusTitle: "Off",
  startField: "widgetLeaveGroupV2",
  endField: "widgetLeaveGroupV2",
};

const BASE_CONFIG: Config = {
  appId: "cli_test",
  appSecret: "secret",
  encryptKey: "",
  verificationToken: "verify",
  domain: "https://open.larksuite.com",
  timezone: TZ,
  scanLookbackDays: 60,
  approvalMapping: {
    [REMOTE_CODE]: REMOTE_CFG,
    [OFF_CODE]: OFF_CFG,
  },
};

const REMOTE_HALF_DAY_FORM = JSON.stringify([
  {
    id: "widget17804706081600001",
    name: "DateInterval",
    type: "dateInterval",
    value: {
      end: "2026-11-25T10:00:00Z",
      interval: 4,
      start: "2026-11-25T06:00:00Z",
      timezoneOffset: -420,
    },
  },
]);

const OFF_ONE_DAY_FORM = JSON.stringify([
  {
    id: "widgetLeaveGroupV2",
    name: "Leave component",
    type: "leaveGroupV2",
    ext: { widgetLeaveRuleType: 0 },
    value: {
      end: "2026-11-25T17:00:00Z",
      interval: "1",
      name: "Annual leave",
      reason: "x",
      start: "2026-11-24T17:00:00Z",
      timezoneOffset: -420,
      unit: "DAY",
    },
  },
]);

const OFF_NOV27_FORM = JSON.stringify([
  {
    id: "widgetLeaveGroupV2",
    name: "Leave component",
    type: "leaveGroupV2",
    ext: { widgetLeaveRuleType: 0 },
    value: {
      end: "2026-11-27T17:00:00Z",
      interval: "1",
      name: "Annual leave",
      reason: "x",
      start: "2026-11-26T17:00:00Z",
      timezoneOffset: -420,
      unit: "DAY",
    },
  },
]);

function makeFakeStore(): ScheduleStore {
  const data = new Map<string, { value: string; metadata?: unknown }>();
  return {
    async put(key, value, opts) {
      data.set(key, { value, metadata: opts?.metadata });
    },
    async delete(key) {
      data.delete(key);
    },
    async list(opts) {
      const prefix = opts?.prefix ?? "";
      const keys = [...data.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([name, rec]) => ({ name, metadata: rec.metadata }));
      return { keys, list_complete: true };
    },
  };
}

function makeInst(overrides: Partial<ApprovalInstance> & { reverted?: boolean } = {}): ApprovalInstance {
  return {
    instance_code: "INST_1",
    approval_code: REMOTE_CODE,
    status: "APPROVED",
    open_id: "ou_user1",
    form: REMOTE_HALF_DAY_FORM,
    ...overrides,
  };
}

describe("decide", () => {
  const now10amVN = new Date("2026-11-25T03:00:00Z");

  it("opens Remote half-day APPROVED with real endUnix", () => {
    expect(decide(makeInst(), REMOTE_CFG, TZ, now10amVN)).toEqual([
      {
        action: "open",
        statusTitle: "Remote",
        userId: "ou_user1",
        endUnix: 1795600800,
      },
    ]);
  });

  it("opens Off 1-day APPROVED with endUnix 1795626000", () => {
    const inst = makeInst({ approval_code: OFF_CODE, form: OFF_ONE_DAY_FORM });
    expect(decide(inst, OFF_CFG, TZ, now10amVN)).toEqual([
      {
        action: "open",
        statusTitle: "Off",
        userId: "ou_user1",
        endUnix: 1795626000,
      },
    ]);
  });

  it("schedules future Off on Nov 27", () => {
    const inst = makeInst({
      instance_code: "INST_FUTURE",
      approval_code: OFF_CODE,
      form: OFF_NOV27_FORM,
    });
    expect(decide(inst, OFF_CFG, TZ, now10amVN)).toEqual([
      {
        action: "schedule",
        entry: {
          instanceCode: "INST_FUTURE",
          approvalCode: OFF_CODE,
          statusTitle: "Off",
          openId: "ou_user1",
          startDate: "2026-11-27",
          endDate: "2026-11-27",
          endUnix: 1795798800,
        },
      },
    ]);
  });

  it("skips Remote half-day APPROVED when now is past end time (18:00 VN)", () => {
    const now6pmVN = new Date("2026-11-25T11:00:00Z");
    expect(decide(makeInst(), REMOTE_CFG, TZ, now6pmVN)).toEqual([
      { action: "skip", reason: "outside_range" },
    ]);
  });

  it("handles CANCELED active, CANCELED future, and reverted: true + APPROVED", () => {
    const activeCanceled = makeInst({ status: "CANCELED" });
    expect(decide(activeCanceled, REMOTE_CFG, TZ, now10amVN)).toEqual([
      { action: "unschedule" },
      { action: "close", statusTitle: "Remote", userId: "ou_user1" },
    ]);

    const futureCanceled = makeInst({
      approval_code: OFF_CODE,
      status: "CANCELED",
      form: OFF_NOV27_FORM,
    });
    expect(decide(futureCanceled, OFF_CFG, TZ, now10amVN)).toEqual([
      { action: "unschedule" },
    ]);

    const revertedApproved = makeInst({ status: "APPROVED", reverted: true });
    expect(decide(revertedApproved, REMOTE_CFG, TZ, now10amVN)).toEqual([
      { action: "unschedule" },
      { action: "close", statusTitle: "Remote", userId: "ou_user1" },
    ]);
  });

  it("skips PENDING, unmapped approval code, and unparsable form", () => {
    expect(decide(makeInst({ status: "PENDING" }), REMOTE_CFG, TZ, now10amVN)).toEqual([
      { action: "skip", reason: "status_PENDING" },
    ]);
    expect(decide(makeInst(), undefined, TZ, now10amVN)).toEqual([
      { action: "skip", reason: "unmapped" },
    ]);
    expect(decide(makeInst({ form: "bad-json" }), REMOTE_CFG, TZ, now10amVN)).toEqual([
      { action: "skip", reason: "unparsable_form" },
    ]);
  });
});

describe("handleInstance & runDaily", () => {
  const now10amVN = new Date("2026-11-25T03:00:00Z");

  beforeEach(() => {
    clearStatusCache();
  });

  it("handleInstance opens today APPROVED, schedules future, and unschedules future CANCELED", async () => {
    const instances = new Map<string, ApprovalInstance>([
      ["INST_TODAY", makeInst({ instance_code: "INST_TODAY" })],
      [
        "INST_FUTURE",
        makeInst({
          instance_code: "INST_FUTURE",
          approval_code: OFF_CODE,
          form: OFF_NOV27_FORM,
        }),
      ],
      [
        "INST_FUTURE_CANCELED",
        makeInst({
          instance_code: "INST_FUTURE",
          approval_code: OFF_CODE,
          status: "CANCELED",
          form: OFF_NOV27_FORM,
        }),
      ],
    ]);

    const batchOpenCalls: unknown[] = [];
    const client: LarkClient = {
      async request<T>(_method: "GET" | "POST", path: string, opts?: { body?: unknown }): Promise<T> {
        if (path.startsWith("/approval/v4/instances/")) {
          const code = decodeURIComponent(path.slice("/approval/v4/instances/".length));
          const inst = instances.get(code);
          if (!inst) throw new Error(`Missing instance ${code}`);
          return inst as T;
        }
        if (path === "/personal_settings/v1/system_statuses") {
          return {
            items: [
              { system_status_id: "st_remote", title: "Remote", icon_key: "k1", priority: 1 },
              { system_status_id: "st_off", title: "Off", icon_key: "k2", priority: 2 },
            ],
            has_more: false,
          } as T;
        }
        if (path.endsWith("/batch_open")) {
          batchOpenCalls.push({ path, body: opts?.body });
          return { result_list: [{ user_id: "ou_user1", result: "success" }] } as T;
        }
        throw new Error(`Unexpected path: ${path}`);
      },
    };

    const store = makeFakeStore();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await handleInstance(client, BASE_CONFIG, store, "INST_TODAY", now10amVN);
      expect(batchOpenCalls).toEqual([
        {
          path: "/personal_settings/v1/system_statuses/st_remote/batch_open",
          body: { user_list: [{ user_id: "ou_user1", end_time: "1795600800" }] },
        },
      ]);

      await handleInstance(client, BASE_CONFIG, store, "INST_FUTURE", now10amVN);
      expect(batchOpenCalls).toHaveLength(1);
      expect(await listEntries(store)).toHaveLength(1);

      await handleInstance(client, BASE_CONFIG, store, "INST_FUTURE_CANCELED", now10amVN);
      expect(batchOpenCalls).toHaveLength(1);
      expect(await listEntries(store)).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("runDaily opens due APPROVED, skips due CANCELED, keeps tomorrow, and removes expired", async () => {
    const store = makeFakeStore();
    const dueApproved: ScheduleEntry = {
      instanceCode: "DUE_OK",
      approvalCode: OFF_CODE,
      statusTitle: "Off",
      openId: "ou_ok",
      startDate: "2026-11-25",
      endDate: "2026-11-25",
      endUnix: 1795626000,
    };
    const dueCanceled: ScheduleEntry = {
      instanceCode: "DUE_CANCEL",
      approvalCode: OFF_CODE,
      statusTitle: "Off",
      openId: "ou_cancel",
      startDate: "2026-11-25",
      endDate: "2026-11-25",
      endUnix: 1795626000,
    };
    const tomorrow: ScheduleEntry = {
      instanceCode: "TOMORROW",
      approvalCode: OFF_CODE,
      statusTitle: "Off",
      openId: "ou_tomorrow",
      startDate: "2026-11-26",
      endDate: "2026-11-26",
      endUnix: 1795712400,
    };
    const expired: ScheduleEntry = {
      instanceCode: "EXPIRED",
      approvalCode: OFF_CODE,
      statusTitle: "Off",
      openId: "ou_expired",
      startDate: "2026-11-24",
      endDate: "2026-11-24",
      endUnix: 1795539600,
    };

    await saveEntry(store, dueApproved);
    await saveEntry(store, dueCanceled);
    await saveEntry(store, tomorrow);
    await saveEntry(store, expired);

    const batchOpenCalls: { path: string; body: unknown }[] = [];
    const client: LarkClient = {
      async request<T>(_method: "GET" | "POST", path: string, opts?: { body?: unknown }): Promise<T> {
        if (path === "/approval/v4/instances/DUE_OK") {
          return makeInst({
            instance_code: "DUE_OK",
            approval_code: OFF_CODE,
            status: "APPROVED",
            open_id: "ou_ok",
            form: OFF_ONE_DAY_FORM,
          }) as T;
        }
        if (path === "/approval/v4/instances/DUE_CANCEL") {
          return makeInst({
            instance_code: "DUE_CANCEL",
            approval_code: OFF_CODE,
            status: "CANCELED",
            open_id: "ou_cancel",
            form: OFF_ONE_DAY_FORM,
          }) as T;
        }
        if (path === "/personal_settings/v1/system_statuses") {
          return {
            items: [{ system_status_id: "st_off", title: "Off", icon_key: "k2", priority: 2 }],
            has_more: false,
          } as T;
        }
        if (path.endsWith("/batch_open")) {
          batchOpenCalls.push({ path, body: opts?.body });
          return { result_list: [{ user_id: "ou_ok", result: "success" }] } as T;
        }
        throw new Error(`Unexpected path: ${path}`);
      },
    };

    const result = await runDaily(client, BASE_CONFIG, store, now10amVN);
    expect(result).toEqual({ opened: 1, skipped: 1, removed: 1 });
    expect(batchOpenCalls).toHaveLength(1);
    expect(batchOpenCalls[0]).toEqual({
      path: "/personal_settings/v1/system_statuses/st_off/batch_open",
      body: { user_list: [{ user_id: "ou_ok", end_time: "1795626000" }] },
    });
    expect(await listEntries(store)).toEqual([tomorrow]);
  });
});
