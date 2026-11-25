import { describe, expect, it } from "vitest";
import { dateIn, endOfDayUnix, todayIn } from "../src/date";

const VN = "Asia/Ho_Chi_Minh";

describe("date utilities", () => {
  it("todayIn handles UTC boundary in Asia/Ho_Chi_Minh", () => {
    expect(todayIn(VN, new Date("2026-11-24T17:30:00Z"))).toBe("2026-11-25");
    expect(todayIn(VN, new Date("2026-11-24T16:59:59Z"))).toBe("2026-11-24");
  });

  it("endOfDayUnix computes 23:59:59 in Asia/Ho_Chi_Minh and UTC", () => {
    expect(endOfDayUnix("2026-11-25", VN)).toBe(1795625999);
    expect(endOfDayUnix("2026-11-25", "UTC")).toBe(1795651199);
  });

  it("endOfDayUnix handles DST timezones accurately", () => {
    // 2026-11-01 is DST fall-back day in America/New_York (23:59:59 is EST, UTC-5)
    // 2026-11-01T23:59:59-05:00 = 2026-11-02T04:59:59Z
    expect(endOfDayUnix("2026-11-01", "America/New_York")).toBe(
      Math.floor(Date.UTC(2026, 10, 2, 4, 59, 59) / 1000),
    );
  });

  it("dateIn accepts ISO strings and epoch ms", () => {
    expect(dateIn("2026-11-24T18:00:00Z", VN)).toBe("2026-11-25");
    expect(dateIn(1795625999000, VN)).toBe("2026-11-25");
  });

  it("throws on invalid date formats or inputs", () => {
    expect(() => endOfDayUnix("25/11/2026", VN)).toThrow();
    expect(() => endOfDayUnix("2026-02-30", VN)).toThrow();
    expect(() => dateIn("not-a-date", VN)).toThrow();
  });
});
