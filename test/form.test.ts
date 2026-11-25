import { describe, expect, it } from "vitest";
import type { ApprovalConfig } from "../src/config";
import { parseForm } from "../src/form";

const TZ = "Asia/Ho_Chi_Minh";

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

const OFF_THREE_DAYS_FORM = JSON.stringify([
  {
    id: "widgetLeaveGroupV2",
    name: "Leave component",
    type: "leaveGroupV2",
    ext: { widgetLeaveRuleType: 0 },
    value: {
      end: "2026-11-27T17:00:00Z",
      interval: "3",
      name: "Annual leave",
      reason: "x",
      start: "2026-11-24T17:00:00Z",
      timezoneOffset: -420,
      unit: "DAY",
    },
  },
]);

describe("parseForm", () => {
  it("parses Remote half-day form", () => {
    expect(parseForm(REMOTE_HALF_DAY_FORM, REMOTE_CFG, TZ)).toEqual({
      startDate: "2026-11-25",
      endDate: "2026-11-25",
      endUnix: 1795600800,
    });
  });

  it("parses Off 1-day form without spilling into next day", () => {
    expect(parseForm(OFF_ONE_DAY_FORM, OFF_CFG, TZ)).toEqual({
      startDate: "2026-11-25",
      endDate: "2026-11-25",
      endUnix: 1795626000,
    });
  });

  it("parses Off 3-day form", () => {
    expect(parseForm(OFF_THREE_DAYS_FORM, OFF_CFG, TZ)).toEqual({
      startDate: "2026-11-25",
      endDate: "2026-11-27",
      endUnix: 1795798800,
    });
  });

  it("returns null for malformed JSON, missing widget, mismatched fields, or end <= start", () => {
    expect(parseForm("{bad json", REMOTE_CFG, TZ)).toBeNull();
    expect(parseForm("{}", REMOTE_CFG, TZ)).toBeNull();
    expect(parseForm("[]", REMOTE_CFG, TZ)).toBeNull();
    expect(
      parseForm(
        REMOTE_HALF_DAY_FORM,
        { statusTitle: "Remote", startField: "w1", endField: "w2" },
        TZ,
      ),
    ).toBeNull();

    const endBeforeStart = JSON.stringify([
      {
        id: "widget17804706081600001",
        type: "dateInterval",
        value: {
          start: "2026-11-25T10:00:00Z",
          end: "2026-11-25T10:00:00Z",
        },
      },
    ]);
    expect(parseForm(endBeforeStart, REMOTE_CFG, TZ)).toBeNull();
  });
});
